import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/db/client";
import { assertCanAccept, assertCanSettle, isFullyAccepted, settlementsForSideBet, SIDE_BET_PRESETS, type SideBet } from "@/domain/side-bets";
import { recordAudit } from "./audit";
import { loadRoundSnapshot } from "./roundProjection";

export const createSideBetSchema = z.object({
  roundId: z.string(),
  type: z.enum(SIDE_BET_PRESETS.map((p) => p.type) as [string, ...string[]]),
  description: z.string().trim().min(1).max(120),
  amountCents: z.number().int().min(100).max(100000),
  basis: z.enum(["GROSS", "NET"]).default("GROSS"),
  holeNumbers: z.array(z.number().int().min(1).max(18)).default([]),
  opponentIds: z.array(z.string()).min(1, "Pick at least one opponent"),
});
export type CreateSideBetInput = z.infer<typeof createSideBetSchema>;

export async function createSideBet(input: CreateSideBetInput, creatorId: string): Promise<string> {
  const data = createSideBetSchema.parse(input);
  if (data.opponentIds.includes(creatorId)) throw new Error("You cannot bet against yourself");
  const db = await getDb();
  const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, data.roundId));
  if (!round || round.status !== "LIVE") throw new Error("Side bets can only be created on a live round");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(s.sideBets).values({
      id,
      roundId: data.roundId,
      holeNumber: data.holeNumbers.length === 1 ? data.holeNumbers[0] : null,
      creatorId,
      type: data.type,
      description: data.description,
      amountCents: data.amountCents,
      basis: data.basis,
      holeNumbersJson: data.holeNumbers,
      status: "PROPOSED",
    });
    await tx.insert(s.sideBetParticipants).values([
      { sideBetId: id, playerId: creatorId, side: "A", acceptedAt: new Date() },
      ...data.opponentIds.map((pid) => ({ sideBetId: id, playerId: pid, side: "B", acceptedAt: null })),
    ]);
    await recordAudit(tx as never, { actorId: creatorId, entityType: "side_bet", entityId: id, action: "PROPOSE", after: data });
  });
  return id;
}

async function loadBet(roundId: string, betId: string) {
  const snap = await loadRoundSnapshot(roundId);
  const bet = snap?.sideBets.find((b) => b.id === betId);
  if (!snap || !bet) throw new Error("Side bet not found");
  return { snap, bet };
}

export async function acceptSideBet(roundId: string, betId: string, actorId: string): Promise<void> {
  const { bet } = await loadBet(roundId, betId);
  assertCanAccept(bet, actorId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx.update(s.sideBetParticipants).set({ acceptedAt: now }).where(and(eq(s.sideBetParticipants.sideBetId, betId), eq(s.sideBetParticipants.playerId, actorId)));
    const updated: SideBet = { ...bet, participants: bet.participants.map((p) => (p.playerId === actorId ? { ...p, acceptedAt: now.toISOString() } : p)) };
    if (isFullyAccepted(updated)) {
      await tx.update(s.sideBets).set({ status: "ACCEPTED", acceptedAt: now }).where(eq(s.sideBets.id, betId));
    }
    await recordAudit(tx as never, { actorId, entityType: "side_bet", entityId: betId, action: "ACCEPT" });
  });
}

export async function declineSideBet(roundId: string, betId: string, actorId: string): Promise<void> {
  const { bet } = await loadBet(roundId, betId);
  if (bet.status !== "PROPOSED") throw new Error("Only a proposed bet can be declined");
  if (!bet.participants.some((p) => p.playerId === actorId)) throw new Error("Not your bet");
  const db = await getDb();
  await db.update(s.sideBets).set({ status: bet.creatorId === actorId ? "CANCELLED" : "DECLINED" }).where(eq(s.sideBets.id, betId));
  await recordAudit(db, { actorId, entityType: "side_bet", entityId: betId, action: bet.creatorId === actorId ? "CANCEL" : "DECLINE" });
}

/** Resolve with an explicit winner side (manual) or "AUTO" to use deterministic score data. */
export async function resolveSideBet(roundId: string, betId: string, winner: "A" | "B" | "TIE" | "AUTO", actorId: string): Promise<void> {
  const { snap, bet } = await loadBet(roundId, betId);
  assertCanSettle(bet);
  let result: "A" | "B" | "TIE";
  if (winner === "AUTO") {
    if (!bet.autoResult) throw new Error("This bet cannot be auto-resolved yet; pick the winner manually");
    result = bet.autoResult;
  } else {
    result = winner;
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const winnerPlayerId = result === "TIE" ? null : (bet.participants.find((p) => p.side === result)?.playerId ?? null);
    await tx.insert(s.sideBetResolutions).values({
      id: crypto.randomUUID(),
      sideBetId: betId,
      winnerSide: result === "TIE" ? null : result,
      winnerPlayerId,
      resultJson: { mode: winner === "AUTO" ? "AUTO" : "MANUAL", result },
      resolvedBy: actorId,
    });
    await tx.update(s.sideBets).set({ status: result === "TIE" ? "VOID" : "SETTLED" }).where(eq(s.sideBets.id, betId));
    if (result !== "TIE") {
      const settlements = settlementsForSideBet(bet, result, bet.terms.description);
      await tx.insert(s.ledgerEntries).values(
        settlements.map((st) => ({
          id: crypto.randomUUID(),
          tripId: snap.round.tripId,
          roundId,
          sourceType: "SIDE_BET",
          sourceId: betId,
          fromPlayerId: st.fromPlayerId,
          toPlayerId: st.toPlayerId,
          amountCents: st.amountCents,
          memo: st.memo,
        })),
      );
    }
    await recordAudit(tx as never, { actorId, entityType: "side_bet", entityId: betId, action: "RESOLVE", after: { result, mode: winner } });
  });
}
