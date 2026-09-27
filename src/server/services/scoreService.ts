import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/db/client";
import { canEditScore, type ScoringMode, type TripRole } from "./permissions";
import { recordAudit } from "./audit";

export const holeScorePatchSchema = z.object({
  grossScore: z.number().int().min(1).max(20).nullable().optional(),
  putts: z.number().int().min(0).max(10).nullable().optional(),
  fairwayResult: z.enum(["HIT", "LEFT", "RIGHT", "SHORT", "LONG"]).nullable().optional(),
  gir: z.boolean().nullable().optional(),
  penaltyStrokes: z.number().int().min(0).max(10).optional(),
  obStrokes: z.number().int().min(0).max(10).optional(),
  sandAttempt: z.boolean().nullable().optional(),
  sandSave: z.boolean().nullable().optional(),
  upDownAttempt: z.boolean().nullable().optional(),
  upDown: z.boolean().nullable().optional(),
  driveDistance: z.number().int().min(0).max(500).nullable().optional(),
});
export type HoleScorePatch = z.infer<typeof holeScorePatchSchema>;

export interface SaveScoreInput {
  roundId: string;
  playerId: string;
  holeNumber: number;
  patch: HoleScorePatch;
  /** Version the client last saw (0 = new). Mismatch => conflict. */
  expectedVersion: number;
  clientEventId?: string;
  actorId: string;
}

export type SaveScoreResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; current: typeof s.holeScores.$inferSelect }
  | { status: "forbidden"; reason: string };

export async function saveHoleScore(input: SaveScoreInput): Promise<SaveScoreResult> {
  const patch = holeScorePatchSchema.parse(input.patch);
  const db = await getDb();
  const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, input.roundId));
  if (!round) return { status: "forbidden", reason: "Round not found" };
  const [rp] = await db.select().from(s.roundPlayers).where(and(eq(s.roundPlayers.roundId, input.roundId), eq(s.roundPlayers.playerId, input.playerId)));
  if (!rp) return { status: "forbidden", reason: "Player is not in this round" };
  let role: TripRole | null = null;
  if (round.tripId) {
    const [m] = await db.select().from(s.tripMembers).where(and(eq(s.tripMembers.tripId, round.tripId), eq(s.tripMembers.playerProfileId, input.actorId)));
    role = (m?.role as TripRole) ?? null;
  }
  const allowed = canEditScore({
    actorId: input.actorId,
    actorRole: role,
    scoringMode: round.scoringMode as ScoringMode,
    scorerPlayerId: rp.scorerPlayerId,
    targetPlayerId: input.playerId,
    roundStatus: round.status,
  });
  if (!allowed) return { status: "forbidden", reason: round.status !== "LIVE" ? "Round is locked" : "You cannot edit this player's score in this scoring mode" };

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(s.holeScores)
      .where(and(eq(s.holeScores.roundId, input.roundId), eq(s.holeScores.playerId, input.playerId), eq(s.holeScores.holeNumber, input.holeNumber)));

    if (existing && input.clientEventId && existing.clientEventId === input.clientEventId) {
      return { status: "saved", version: existing.version } as const; // idempotent replay
    }
    if (existing && existing.version !== input.expectedVersion) {
      return { status: "conflict", current: existing } as const;
    }
    if (!existing && input.expectedVersion !== 0) {
      return { status: "forbidden", reason: "Stale client state" } as const;
    }
    const now = new Date();
    if (!existing) {
      await tx.insert(s.holeScores).values({
        roundId: input.roundId,
        playerId: input.playerId,
        holeNumber: input.holeNumber,
        grossScore: patch.grossScore ?? null,
        putts: patch.putts ?? null,
        fairwayResult: patch.fairwayResult ?? null,
        gir: patch.gir ?? null,
        penaltyStrokes: patch.penaltyStrokes ?? 0,
        obStrokes: patch.obStrokes ?? 0,
        sandAttempt: patch.sandAttempt ?? null,
        sandSave: patch.sandSave ?? null,
        upDownAttempt: patch.upDownAttempt ?? null,
        upDown: patch.upDown ?? null,
        driveDistance: patch.driveDistance ?? null,
        version: 1,
        updatedAt: now,
        updatedBy: input.actorId,
        clientEventId: input.clientEventId ?? null,
      });
      return { status: "saved", version: 1 } as const;
    }
    const next = { ...existing, ...stripUndefined(patch), version: existing.version + 1, updatedAt: now, updatedBy: input.actorId, clientEventId: input.clientEventId ?? null };
    await tx
      .update(s.holeScores)
      .set(next)
      .where(and(eq(s.holeScores.roundId, input.roundId), eq(s.holeScores.playerId, input.playerId), eq(s.holeScores.holeNumber, input.holeNumber)));
    // Material change after initial submission: keep an audit trail.
    if (existing.grossScore !== null && patch.grossScore !== undefined && patch.grossScore !== existing.grossScore) {
      await recordAudit(tx as never, {
        actorId: input.actorId,
        entityType: "hole_score",
        entityId: `${input.roundId}:${input.playerId}:${input.holeNumber}`,
        action: "CHANGE_GROSS",
        before: { grossScore: existing.grossScore, version: existing.version },
        after: { grossScore: patch.grossScore, version: next.version },
      });
    }
    return { status: "saved", version: next.version } as const;
  });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
