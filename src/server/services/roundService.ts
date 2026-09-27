import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/db/client";
import { calculateCourseHandicap, calculatePlayingHandicap } from "@/domain/handicap";
import { getGameDefinition } from "@/domain/games";
import { recordAudit } from "./audit";
import { loadRoundSnapshot } from "./roundProjection";

const holeSchema = z.object({ holeNumber: z.number().int().min(1).max(18), par: z.number().int().min(3).max(6), yardage: z.number().int().min(50).max(800).nullable(), strokeIndex: z.number().int().min(1).max(18) });

export const createRoundSchema = z.object({
  tripId: z.string(),
  name: z.string().trim().max(60).optional().or(z.literal("")),
  startsAt: z.string().optional().or(z.literal("")),
  countsTowardTrip: z.boolean().default(true),
  scoringMode: z.enum(["GROUP_SCORER", "INDIVIDUAL", "HYBRID"]).default("HYBRID"),
  scorerPlayerId: z.string().optional().nullable(),
  playerIds: z.array(z.string()).min(1, "Pick at least one player"),
  course: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), teeSetId: z.string() }),
    z.object({
      mode: z.literal("manual"),
      name: z.string().trim().min(1, "Course name is required").max(80),
      teeName: z.string().trim().min(1).max(30).default("White"),
      courseRating: z.number().min(55).max(85),
      slopeRating: z.number().int().min(55).max(155),
      holes: z.array(holeSchema).length(18),
    }),
  ]),
  games: z
    .array(
      z.object({
        type: z.string(),
        name: z.string().trim().min(1).max(60),
        rules: z.record(z.string(), z.unknown()),
        participantIds: z.array(z.string()).optional(),
        teams: z.array(z.object({ name: z.string(), playerIds: z.array(z.string()) })).optional(),
      }),
    )
    .default([]),
});
export type CreateRoundInput = z.infer<typeof createRoundSchema>;

export async function createRound(input: CreateRoundInput, actorId: string | null): Promise<string> {
  const data = createRoundSchema.parse(input);
  const db = await getDb();
  // Validate every game's rules before touching the DB.
  for (const g of data.games) {
    const v = getGameDefinition(g.type).validateRules(g.rules);
    if (!v.ok) throw new Error(`${g.name}: ${v.errors.join("; ")}`);
  }
  const roundId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    let courseId: string;
    let teeSetId: string;
    let par: number;
    let courseRating: number;
    let slopeRating: number;
    if (data.course.mode === "existing") {
      const [tee] = await tx.select().from(s.teeSets).where(eq(s.teeSets.id, data.course.teeSetId));
      if (!tee) throw new Error("Tee set not found");
      courseId = tee.courseId;
      teeSetId = tee.id;
      par = tee.par;
      courseRating = tee.courseRating;
      slopeRating = tee.slopeRating;
    } else {
      const c = data.course;
      const sis = new Set(c.holes.map((h) => h.strokeIndex));
      if (sis.size !== 18) throw new Error("Stroke indexes must be unique 1-18");
      courseId = crypto.randomUUID();
      teeSetId = crypto.randomUUID();
      par = c.holes.reduce((a, h) => a + h.par, 0);
      courseRating = c.courseRating;
      slopeRating = c.slopeRating;
      await tx.insert(s.courses).values({ id: courseId, name: c.name, providerKey: "manual" });
      await tx.insert(s.teeSets).values({
        id: teeSetId,
        courseId,
        name: c.teeName,
        par,
        courseRating,
        slopeRating,
        yardage: c.holes.every((h) => h.yardage !== null) ? c.holes.reduce((a, h) => a + (h.yardage ?? 0), 0) : null,
      });
      await tx.insert(s.holes).values(c.holes.map((h) => ({ id: crypto.randomUUID(), teeSetId, ...h })));
    }

    await tx.insert(s.rounds).values({
      id: roundId,
      tripId: data.tripId,
      courseId,
      teeSetId,
      name: data.name || null,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      countsTowardTrip: data.countsTowardTrip,
      scoringMode: data.scoringMode,
      status: "LIVE",
    });

    const profiles = await tx.select().from(s.playerProfiles);
    const rows = data.playerIds.map((pid, i) => {
      const profile = profiles.find((p) => p.id === pid);
      if (!profile) throw new Error(`Unknown player ${pid}`);
      const ch = calculateCourseHandicap({ handicapIndex: profile.handicapIndex, slopeRating, courseRating, par });
      return {
        roundId,
        playerId: pid,
        teeSetId,
        handicapIndexSnapshot: profile.handicapIndex,
        courseHandicapRaw: ch.raw,
        courseHandicap: ch.courseHandicap,
        playingHandicap: calculatePlayingHandicap(ch.courseHandicap, 100),
        orderIndex: i,
        scorerPlayerId: data.scoringMode === "INDIVIDUAL" ? null : (data.scorerPlayerId ?? data.playerIds[0]),
      };
    });
    await tx.insert(s.roundPlayers).values(rows);

    for (const [i, g] of data.games.entries()) {
      const gameId = crypto.randomUUID();
      await tx.insert(s.games).values({ id: gameId, roundId, type: g.type, name: g.name, rulesJson: g.rules, orderIndex: i });
      const teamIdByName = new Map<string, string>();
      for (const t of g.teams ?? []) {
        const teamId = crypto.randomUUID();
        teamIdByName.set(t.name, teamId);
        await tx.insert(s.gameTeams).values({ id: teamId, gameId, name: t.name });
      }
      const participantIds = g.participantIds?.length ? g.participantIds : data.playerIds;
      await tx.insert(s.gameParticipants).values(
        participantIds.map((pid, idx) => ({
          gameId,
          playerId: pid,
          orderIndex: idx,
          teamId: [...(g.teams ?? [])].find((t) => t.playerIds.includes(pid)) ? teamIdByName.get([...(g.teams ?? [])].find((t) => t.playerIds.includes(pid))!.name)! : null,
        })),
      );
    }
    await recordAudit(tx as never, { actorId, entityType: "round", entityId: roundId, action: "CREATE", after: { ...data, roundId } });
  });
  return roundId;
}

export interface FinishCheck {
  ok: boolean;
  problems: string[];
}

export async function checkRoundFinishable(roundId: string): Promise<FinishCheck> {
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) return { ok: false, problems: ["Round not found"] };
  const problems: string[] = [];
  if (snap.round.status !== "LIVE") problems.push(`Round is ${snap.round.status.toLowerCase()}`);
  for (const p of snap.players) {
    const t = snap.totals[p.playerId];
    if (!t.isComplete) problems.push(`${p.displayName} has ${snap.holes.length - t.holesPlayed} hole(s) without a score`);
  }
  for (const b of snap.sideBets) {
    if (b.status === "PROPOSED") problems.push(`Side bet "${b.terms.description}" is still waiting for acceptance`);
    if (b.status === "ACCEPTED") problems.push(`Side bet "${b.terms.description}" has not been resolved`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Finish + lock: store final game results and post one immutable ledger entry per
 * settlement. Trip standings are derived from locked rounds, never stored.
 */
export async function finishRound(roundId: string, actorId: string | null): Promise<void> {
  const check = await checkRoundFinishable(roundId);
  if (!check.ok) throw new Error(check.problems.join(". "));
  const snap = (await loadRoundSnapshot(roundId))!;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const now = new Date();
    for (const g of snap.games) {
      await tx.insert(s.gameResults).values({
        id: crypto.randomUUID(),
        gameId: g.id,
        scopeType: "ROUND",
        scopeKey: "FINAL",
        resultJson: { summary: g.summary, settlements: g.settlements, state: g.state },
        lockedAt: now,
      });
      await tx.update(s.games).set({ status: "FINALIZED" }).where(eq(s.games.id, g.id));
      if (g.settlements.length) {
        await tx.insert(s.ledgerEntries).values(
          g.settlements.map((st) => ({
            id: crypto.randomUUID(),
            tripId: snap.round.tripId,
            roundId,
            sourceType: "GAME",
            sourceId: g.id,
            fromPlayerId: st.fromPlayerId,
            toPlayerId: st.toPlayerId,
            amountCents: st.amountCents,
            memo: `${g.name}: ${st.memo}`,
          })),
        );
      }
    }
    await tx.update(s.rounds).set({ status: "LOCKED", lockedAt: now }).where(eq(s.rounds.id, roundId));
    await recordAudit(tx as never, { actorId, entityType: "round", entityId: roundId, action: "LOCK", after: { games: snap.games.map((g) => ({ id: g.id, settlements: g.settlements })) } });
  });
}

/**
 * Organizer correction: reopen a locked round. Game ledger entries are reversed by
 * appending REVERSAL entries (never deleted); finishing again re-posts fresh results.
 */
export async function reopenRound(roundId: string, actorId: string | null, reason: string): Promise<void> {
  const db = await getDb();
  const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
  if (!round) throw new Error("Round not found");
  if (round.status !== "LOCKED") throw new Error("Only a locked round can be reopened");
  await db.transaction(async (tx) => {
    const entries = await tx.select().from(s.ledgerEntries).where(and(eq(s.ledgerEntries.roundId, roundId), eq(s.ledgerEntries.sourceType, "GAME"), eq(s.ledgerEntries.status, "POSTED")));
    for (const e of entries) {
      await tx.update(s.ledgerEntries).set({ status: "REVERSED" }).where(eq(s.ledgerEntries.id, e.id));
      await tx.insert(s.ledgerEntries).values({
        id: crypto.randomUUID(),
        tripId: e.tripId,
        roundId: e.roundId,
        sourceType: "REVERSAL",
        sourceId: e.sourceId,
        fromPlayerId: e.toPlayerId,
        toPlayerId: e.fromPlayerId,
        amountCents: e.amountCents,
        status: "REVERSED",
        memo: `Reversal of "${e.memo}" (${reason})`,
        reversesEntryId: e.id,
      });
    }
    await tx.update(s.games).set({ status: "ACTIVE" }).where(eq(s.games.roundId, roundId));
    await tx.update(s.rounds).set({ status: "LIVE", lockedAt: null }).where(eq(s.rounds.id, roundId));
    await recordAudit(tx as never, { actorId, entityType: "round", entityId: roundId, action: "REOPEN", before: { status: "LOCKED" }, after: { status: "LIVE", reason, reversedEntries: entries.map((e) => e.id) } });
  });
}
