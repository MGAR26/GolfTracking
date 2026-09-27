import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema as s } from "@/db/client";
import type { HoleEntry, HoleInfo, RoundPlayerInfo } from "@/domain/types";
import { emptyHoleEntry } from "@/domain/types";
import { allocateStrokes, calculatePlayingHandicap } from "@/domain/handicap";
import { buildLeaderboard, computePlayerRoundTotals, type LeaderboardRow, type PlayerRoundTotals } from "@/domain/scoring";
import { getGameDefinition, runGame, type GameContext, type GameSettlement, type LiveGameSummary } from "@/domain/games";
import { computeRoundStats, type RoundStats } from "@/domain/stats";
import type { SideBet } from "@/domain/side-bets";
import { autoResolve } from "@/domain/side-bets";

export interface ProjectedGame {
  id: string;
  type: string;
  name: string;
  rules: Record<string, unknown>;
  status: string;
  participantIds: string[];
  teams: GameContext["teams"];
  summary: LiveGameSummary;
  settlements: GameSettlement[];
  holesFinalized: number[];
  /** Serializable state for audit / game_results. */
  state: unknown;
}

export interface ProjectedSideBet extends SideBet {
  holeNumber: number | null;
  createdAt: string;
  autoResult: "A" | "B" | "TIE" | null;
  resolution: { winnerSide: string | null; winnerPlayerId: string | null; resolvedAt: string } | null;
}

export interface ScoreRow {
  entry: HoleEntry;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface RoundSnapshot {
  round: typeof s.rounds.$inferSelect;
  course: typeof s.courses.$inferSelect;
  teeSet: typeof s.teeSets.$inferSelect;
  holes: HoleInfo[];
  players: (RoundPlayerInfo & { playingHandicap: number; orderIndex: number; scorerPlayerId: string | null; tripRole: string | null })[];
  entries: HoleEntry[];
  scores: ScoreRow[];
  totals: Record<string, PlayerRoundTotals>;
  leaderboardNet: LeaderboardRow[];
  leaderboardGross: LeaderboardRow[];
  stats: Record<string, RoundStats>;
  games: ProjectedGame[];
  sideBets: ProjectedSideBet[];
  /** First hole where at least one player has no score; null when the round is fully scored. */
  currentHole: number | null;
  holesComplete: number;
  nowNotes: string[];
}

export async function loadRoundSnapshot(roundId: string): Promise<RoundSnapshot | null> {
  const db = await getDb();
  const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
  if (!round) return null;
  const [course] = await db.select().from(s.courses).where(eq(s.courses.id, round.courseId));
  const [teeSet] = await db.select().from(s.teeSets).where(eq(s.teeSets.id, round.teeSetId));
  const holeRows = await db.select().from(s.holes).where(eq(s.holes.teeSetId, round.teeSetId)).orderBy(asc(s.holes.holeNumber));
  const holes: HoleInfo[] = holeRows.map((h) => ({ holeNumber: h.holeNumber, par: h.par, yardage: h.yardage, strokeIndex: h.strokeIndex }));

  const rpRows = await db
    .select({ rp: s.roundPlayers, profile: s.playerProfiles })
    .from(s.roundPlayers)
    .innerJoin(s.playerProfiles, eq(s.roundPlayers.playerId, s.playerProfiles.id))
    .where(eq(s.roundPlayers.roundId, roundId))
    .orderBy(asc(s.roundPlayers.orderIndex));

  const roleRows = round.tripId
    ? await db.select().from(s.tripMembers).where(eq(s.tripMembers.tripId, round.tripId))
    : [];
  const roleByPlayer = new Map(roleRows.map((r) => [r.playerProfileId, r.role]));

  const players = rpRows.map(({ rp, profile }) => ({
    playerId: rp.playerId,
    displayName: profile.displayName,
    handicapIndex: rp.handicapIndexSnapshot,
    courseHandicap: rp.courseHandicap,
    playingHandicap: rp.playingHandicap,
    allocation: allocateStrokes(rp.playingHandicap, holes),
    orderIndex: rp.orderIndex,
    scorerPlayerId: rp.scorerPlayerId,
    tripRole: roleByPlayer.get(rp.playerId) ?? null,
  }));

  const scoreRows = await db.select().from(s.holeScores).where(eq(s.holeScores.roundId, roundId));
  const scores: ScoreRow[] = scoreRows.map((r) => ({
    entry: {
      playerId: r.playerId,
      holeNumber: r.holeNumber,
      grossScore: r.grossScore,
      putts: r.putts,
      fairwayResult: (r.fairwayResult as HoleEntry["fairwayResult"]) ?? null,
      gir: r.gir,
      penaltyStrokes: r.penaltyStrokes,
      obStrokes: r.obStrokes,
      sandAttempt: r.sandAttempt,
      sandSave: r.sandSave,
      upDownAttempt: r.upDownAttempt,
      upDown: r.upDown,
      driveDistance: r.driveDistance,
    },
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  }));
  const entries = scores.map((r) => r.entry);

  const totals: Record<string, PlayerRoundTotals> = {};
  const stats: Record<string, RoundStats> = {};
  for (const p of players) {
    totals[p.playerId] = computePlayerRoundTotals(p.playerId, holes, p.allocation, entries);
    stats[p.playerId] = computeRoundStats(p.playerId, holes, entries);
  }
  const lbInput = players.map((p) => ({ playerId: p.playerId, displayName: p.displayName, totals: totals[p.playerId] }));

  // Games
  const gameRows = await db.select().from(s.games).where(eq(s.games.roundId, roundId)).orderBy(asc(s.games.orderIndex));
  const gameIds = gameRows.map((g) => g.id);
  const partRows = gameIds.length ? await db.select().from(s.gameParticipants).where(inArray(s.gameParticipants.gameId, gameIds)) : [];
  const teamRows = gameIds.length ? await db.select().from(s.gameTeams).where(inArray(s.gameTeams.gameId, gameIds)) : [];

  const games: ProjectedGame[] = gameRows.map((g) => {
    const parts = partRows.filter((p) => p.gameId === g.id).sort((a, b) => a.orderIndex - b.orderIndex);
    const gamePlayers: RoundPlayerInfo[] = parts.map((part) => {
      const base = players.find((p) => p.playerId === part.playerId)!;
      const ph = calculatePlayingHandicap(base.courseHandicap, part.handicapAllowance);
      return { ...base, allocation: allocateStrokes(ph, holes) };
    });
    const teams = teamRows
      .filter((t) => t.gameId === g.id)
      .map((t) => ({ teamId: t.id, name: t.name, playerIds: parts.filter((p) => p.teamId === t.id).map((p) => p.playerId) }));
    const ctx: GameContext = { gameId: g.id, holes, players: gamePlayers, teams };
    const def = getGameDefinition(g.type);
    const run = runGame(def, ctx, g.rulesJson, entries);
    // Strip ctx from state for serialization (it is reconstructable).
    const { ctx: _ctx, ...stateRest } = (run.state ?? {}) as Record<string, unknown>;
    void _ctx;
    return {
      id: g.id,
      type: g.type,
      name: g.name,
      rules: g.rulesJson as Record<string, unknown>,
      status: g.status,
      participantIds: parts.map((p) => p.playerId),
      teams,
      summary: run.summary,
      settlements: run.settlements,
      holesFinalized: run.holesFinalized,
      state: stateRest,
    };
  });

  // Side bets
  const betRows = await db.select().from(s.sideBets).where(eq(s.sideBets.roundId, roundId)).orderBy(asc(s.sideBets.createdAt));
  const betIds = betRows.map((b) => b.id);
  const betParts = betIds.length ? await db.select().from(s.sideBetParticipants).where(inArray(s.sideBetParticipants.sideBetId, betIds)) : [];
  const betRes = betIds.length ? await db.select().from(s.sideBetResolutions).where(inArray(s.sideBetResolutions.sideBetId, betIds)) : [];
  const allocationFor = (pid: string) => players.find((p) => p.playerId === pid)?.allocation ?? {};
  const sideBets: ProjectedSideBet[] = betRows.map((b) => {
    const bet: SideBet = {
      id: b.id,
      roundId: b.roundId,
      creatorId: b.creatorId,
      terms: {
        type: b.type as SideBet["terms"]["type"],
        description: b.description,
        amountCents: b.amountCents,
        holeNumbers: (b.holeNumbersJson as number[]) ?? [],
        basis: b.basis as "GROSS" | "NET",
      },
      participants: betParts
        .filter((p) => p.sideBetId === b.id)
        .map((p) => ({ playerId: p.playerId, side: p.side as "A" | "B", acceptedAt: p.acceptedAt?.toISOString() ?? null })),
      status: b.status as SideBet["status"],
    };
    const res = betRes.find((r) => r.sideBetId === b.id);
    return {
      ...bet,
      holeNumber: b.holeNumber,
      createdAt: b.createdAt.toISOString(),
      autoResult: bet.status === "ACCEPTED" ? autoResolve(bet, entries, allocationFor) : null,
      resolution: res ? { winnerSide: res.winnerSide, winnerPlayerId: res.winnerPlayerId, resolvedAt: res.resolvedAt.toISOString() } : null,
    };
  });

  // Current hole = first hole missing any player's gross score.
  let currentHole: number | null = null;
  let holesComplete = 0;
  for (const h of holes) {
    const done = players.every((p) => entries.some((e) => e.playerId === p.playerId && e.holeNumber === h.holeNumber && e.grossScore !== null));
    if (done) holesComplete++;
    else if (currentHole === null) currentHole = h.holeNumber;
  }

  const nowNotes: string[] = [];
  for (const g of games) if (g.summary.nowNote) nowNotes.push(g.summary.nowNote);
  if (currentHole !== null) {
    for (const p of players) {
      const strokes = p.allocation[currentHole] ?? 0;
      if (strokes > 0) nowNotes.push(`${p.displayName} receives ${strokes === 1 ? "a stroke" : `${strokes} strokes`}`);
      if (strokes < 0) nowNotes.push(`${p.displayName} gives ${-strokes === 1 ? "a stroke" : `${-strokes} strokes`}`);
    }
  }

  return {
    round,
    course,
    teeSet,
    holes,
    players,
    entries,
    scores,
    totals,
    leaderboardNet: buildLeaderboard(lbInput, "NET"),
    leaderboardGross: buildLeaderboard(lbInput, "GROSS"),
    stats,
    games,
    sideBets,
    currentHole,
    holesComplete,
    nowNotes,
  };
}

export function findScore(snapshot: RoundSnapshot, playerId: string, holeNumber: number): ScoreRow {
  return (
    snapshot.scores.find((r) => r.entry.playerId === playerId && r.entry.holeNumber === holeNumber) ?? {
      entry: emptyHoleEntry(playerId, holeNumber),
      version: 0,
      updatedAt: "",
      updatedBy: null,
    }
  );
}

export async function listRoundsForTrip(tripId: string) {
  const db = await getDb();
  return db
    .select({ round: s.rounds, course: s.courses, teeSet: s.teeSets })
    .from(s.rounds)
    .innerJoin(s.courses, eq(s.rounds.courseId, s.courses.id))
    .innerJoin(s.teeSets, eq(s.rounds.teeSetId, s.teeSets.id))
    .where(and(eq(s.rounds.tripId, tripId)))
    .orderBy(asc(s.rounds.startsAt), asc(s.rounds.createdAt));
}
