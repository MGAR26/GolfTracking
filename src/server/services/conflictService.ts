import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/db/client";
import { holeScorePatchSchema, saveHoleScore, type HoleScorePatch } from "./scoreService";
import { recordAudit } from "./audit";
import { publishRoundChange } from "@/server/realtime/bus";

export const reportConflictSchema = z.object({
  roundId: z.string(),
  playerId: z.string(),
  holeNumber: z.number().int().min(1).max(18),
  mine: holeScorePatchSchema,
  theirs: holeScorePatchSchema,
  theirsUpdatedBy: z.string().nullable().optional(),
});
export type ReportConflictInput = z.infer<typeof reportConflictSchema>;

/** A player who lost a concurrent edit hands it to the organizer instead of guessing. */
export async function reportConflict(input: ReportConflictInput, reporterId: string): Promise<string> {
  const data = reportConflictSchema.parse(input);
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(s.scoreConflicts).values({
    id,
    roundId: data.roundId,
    playerId: data.playerId,
    holeNumber: data.holeNumber,
    reportedBy: reporterId,
    mineJson: data.mine,
    theirsJson: data.theirs,
    theirsUpdatedBy: data.theirsUpdatedBy ?? null,
  });
  await recordAudit(db, { actorId: reporterId, entityType: "score_conflict", entityId: id, action: "REPORT", after: data });
  publishRoundChange({ type: "conflict", roundId: data.roundId, conflictId: id, actorId: reporterId, at: new Date().toISOString() });
  return id;
}

export async function listOpenConflicts(roundId: string) {
  const db = await getDb();
  const rows = await db
    .select({ conflict: s.scoreConflicts, reporter: s.playerProfiles.displayName })
    .from(s.scoreConflicts)
    .innerJoin(s.playerProfiles, eq(s.scoreConflicts.reportedBy, s.playerProfiles.id))
    .where(and(eq(s.scoreConflicts.roundId, roundId), eq(s.scoreConflicts.status, "OPEN")))
    .orderBy(asc(s.scoreConflicts.createdAt));
  return rows.map((r) => ({ ...r.conflict, mine: r.conflict.mineJson as HoleScorePatch, theirs: r.conflict.theirsJson as HoleScorePatch, reporterName: r.reporter }));
}

/**
 * Organizer picks a side. "MINE" re-applies the reporter's values on top of the current
 * server version (as the organizer); "THEIRS" keeps what is stored. Either way the
 * conflict closes with an audit trail.
 */
export async function resolveConflict(conflictId: string, resolution: "MINE" | "THEIRS" | "DISMISSED", actorId: string): Promise<void> {
  const db = await getDb();
  const [c] = await db.select().from(s.scoreConflicts).where(eq(s.scoreConflicts.id, conflictId));
  if (!c) throw new Error("Conflict not found");
  if (c.status !== "OPEN") throw new Error("Conflict already resolved");
  if (resolution === "MINE") {
    const [current] = await db
      .select({ version: s.holeScores.version })
      .from(s.holeScores)
      .where(and(eq(s.holeScores.roundId, c.roundId), eq(s.holeScores.playerId, c.playerId), eq(s.holeScores.holeNumber, c.holeNumber)));
    const r = await saveHoleScore({
      roundId: c.roundId,
      playerId: c.playerId,
      holeNumber: c.holeNumber,
      patch: c.mineJson as HoleScorePatch,
      expectedVersion: current?.version ?? 0,
      actorId,
      clientEventId: `conflict:${conflictId}`,
    });
    if (r.status !== "saved") throw new Error(r.status === "conflict" ? "The hole changed again; reload and retry" : r.reason);
  }
  await db
    .update(s.scoreConflicts)
    .set({ status: resolution === "DISMISSED" ? "DISMISSED" : "RESOLVED", resolvedBy: actorId, resolution, resolvedAt: new Date() })
    .where(eq(s.scoreConflicts.id, conflictId));
  await recordAudit(db, { actorId, entityType: "score_conflict", entityId: conflictId, action: "RESOLVE", after: { resolution } });
  publishRoundChange({ type: "conflict", roundId: c.roundId, conflictId, actorId, at: new Date().toISOString() });
}
