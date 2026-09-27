import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s } from "@/db/client";
import { computeNetBalances, computePairwiseObligations, type LedgerEntry } from "@/domain/ledger";
import { optimizeSettlement } from "@/domain/settlement";
import { loadRoundSnapshot, listRoundsForTrip } from "./roundProjection";

export const createTripSchema = z.object({
  name: z.string().trim().min(1, "Trip name is required").max(80),
  destination: z.string().trim().max(80).optional().or(z.literal("")),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  players: z
    .array(z.object({ name: z.string().trim().min(1).max(40), handicapIndex: z.number().min(-10).max(54) }))
    .min(1, "Add at least one player")
    .max(32),
});
export type CreateTripInput = z.infer<typeof createTripSchema>;

export async function createTrip(input: CreateTripInput, ownerPlayerId: string | null) {
  const data = createTripSchema.parse(input);
  const db = await getDb();
  const tripId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(s.trips).values({
      id: tripId,
      name: data.name,
      destination: data.destination || null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
    });
    const profiles = data.players.map((p) => ({
      id: crypto.randomUUID(),
      displayName: p.name,
      guestName: p.name,
      handicapIndex: p.handicapIndex,
      handicapUpdatedAt: new Date(),
    }));
    await tx.insert(s.playerProfiles).values(profiles);
    await tx.insert(s.tripMembers).values(
      profiles.map((p, i) => ({ tripId, playerProfileId: p.id, role: i === 0 ? "OWNER" : "PLAYER", orderIndex: i })),
    );
    await tx.insert(s.tripCompetitions).values([
      { id: crypto.randomUUID(), tripId, type: "TOTAL_NET", name: "Total Net", orderIndex: 0 },
      { id: crypto.randomUUID(), tripId, type: "TOTAL_GROSS", name: "Total Gross", orderIndex: 1 },
      { id: crypto.randomUUID(), tripId, type: "MONEY", name: "Money", orderIndex: 2 },
    ]);
    void ownerPlayerId;
  });
  return tripId;
}

export async function listTrips() {
  const db = await getDb();
  const rows = await db.select().from(s.trips).orderBy(desc(s.trips.createdAt));
  const ids = rows.map((t) => t.id);
  const members = ids.length ? await db.select().from(s.tripMembers).where(inArray(s.tripMembers.tripId, ids)) : [];
  const rounds = ids.length ? await db.select({ id: s.rounds.id, tripId: s.rounds.tripId, status: s.rounds.status }).from(s.rounds).where(inArray(s.rounds.tripId, ids)) : [];
  return rows.map((t) => ({
    ...t,
    playerCount: members.filter((m) => m.tripId === t.id).length,
    roundCount: rounds.filter((r) => r.tripId === t.id).length,
    liveRoundId: rounds.find((r) => r.tripId === t.id && r.status === "LIVE")?.id ?? null,
  }));
}

export async function getTripMembers(tripId: string) {
  const db = await getDb();
  return db
    .select({ member: s.tripMembers, profile: s.playerProfiles })
    .from(s.tripMembers)
    .innerJoin(s.playerProfiles, eq(s.tripMembers.playerProfileId, s.playerProfiles.id))
    .where(eq(s.tripMembers.tripId, tripId))
    .orderBy(asc(s.tripMembers.orderIndex));
}

export interface StandingRow {
  playerId: string;
  displayName: string;
  roundsCounted: number;
  totalGross: number;
  totalNet: number;
  grossToPar: number;
  netToPar: number;
  moneyCents: number;
}

export async function getTripLedger(tripId: string): Promise<LedgerEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.tripId, tripId)).orderBy(asc(s.ledgerEntries.createdAt));
  return rows.map((r) => ({
    id: r.id,
    tripId: r.tripId,
    roundId: r.roundId,
    sourceType: r.sourceType as LedgerEntry["sourceType"],
    sourceId: r.sourceId,
    fromPlayerId: r.fromPlayerId,
    toPlayerId: r.toPlayerId,
    amountCents: r.amountCents,
    status: r.status as LedgerEntry["status"],
    memo: r.memo,
    reversesEntryId: r.reversesEntryId,
  }));
}

/** Trip dashboard: standings only include LOCKED rounds flagged counts_toward_trip. */
export async function getTripDashboard(tripId: string) {
  const db = await getDb();
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, tripId));
  if (!trip) return null;
  const members = await getTripMembers(tripId);
  const rounds = await listRoundsForTrip(tripId);
  const ledger = await getTripLedger(tripId);
  const playerIds = members.map((m) => m.profile.id);
  const balances = computeNetBalances(ledger, playerIds);

  const standings: Record<string, StandingRow> = {};
  for (const m of members) {
    standings[m.profile.id] = {
      playerId: m.profile.id,
      displayName: m.profile.displayName,
      roundsCounted: 0,
      totalGross: 0,
      totalNet: 0,
      grossToPar: 0,
      netToPar: 0,
      moneyCents: balances[m.profile.id] ?? 0,
    };
  }
  const recaps: { roundId: string; name: string; courseName: string; status: string; countsTowardTrip: boolean; leader: string | null; holesComplete: number }[] = [];
  for (const r of rounds) {
    const snap = await loadRoundSnapshot(r.round.id);
    if (!snap) continue;
    const top = snap.leaderboardNet[0];
    recaps.push({
      roundId: r.round.id,
      name: r.round.name ?? r.course.name,
      courseName: r.course.name,
      status: r.round.status,
      countsTowardTrip: r.round.countsTowardTrip,
      leader: top && top.holesPlayed > 0 ? top.displayName : null,
      holesComplete: snap.holesComplete,
    });
    if (r.round.status !== "LOCKED" || !r.round.countsTowardTrip) continue;
    for (const p of snap.players) {
      const row = standings[p.playerId];
      if (!row) continue;
      const t = snap.totals[p.playerId].total;
      row.roundsCounted++;
      row.totalGross += t.gross;
      row.totalNet += t.net;
      row.grossToPar += t.grossToPar;
      row.netToPar += t.netToPar;
    }
  }
  const standingRows = Object.values(standings).sort((a, b) => {
    if (a.roundsCounted === 0 && b.roundsCounted === 0) return a.displayName.localeCompare(b.displayName);
    if (a.roundsCounted === 0) return 1;
    if (b.roundsCounted === 0) return -1;
    return a.netToPar - b.netToPar || a.grossToPar - b.grossToPar;
  });

  return {
    trip,
    members,
    rounds: rounds.map((r) => ({ ...r.round, courseName: r.course.name, teeName: r.teeSet.name })),
    recaps,
    standings: standingRows,
    ledger,
    balances,
    obligations: computePairwiseObligations(ledger),
    settlement: optimizeSettlement(balances),
    liveRound: rounds.find((r) => r.round.status === "LIVE")?.round ?? null,
    nextRound: rounds.find((r) => r.round.status === "SETUP")?.round ?? null,
  };
}
