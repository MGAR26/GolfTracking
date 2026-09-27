import type { PlayerId } from "../types";

export type LedgerSourceType = "GAME" | "SIDE_BET" | "ADJUSTMENT" | "REVERSAL";
export type LedgerStatus = "PENDING" | "POSTED" | "REVERSED";

/** Immutable obligation: `from` owes `to` `amountCents`. Corrections append reversals. */
export interface LedgerEntry {
  id: string;
  tripId: string | null;
  roundId: string | null;
  sourceType: LedgerSourceType;
  sourceId: string;
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountCents: number;
  status: LedgerStatus;
  memo: string;
  /** For REVERSAL entries: the id of the entry being reversed. */
  reversesEntryId?: string | null;
}

export type NetBalances = Record<PlayerId, number>;

/** Net position per player: positive = owed money, negative = owes money. */
export function computeNetBalances(entries: LedgerEntry[], playerIds: PlayerId[] = []): NetBalances {
  const balances: NetBalances = {};
  for (const id of playerIds) balances[id] = 0;
  for (const e of entries) {
    if (e.status === "REVERSED") continue;
    if (e.amountCents < 0) throw new Error(`Ledger entry ${e.id} has negative amount`);
    balances[e.fromPlayerId] = (balances[e.fromPlayerId] ?? 0) - e.amountCents;
    balances[e.toPlayerId] = (balances[e.toPlayerId] ?? 0) + e.amountCents;
  }
  return balances;
}

/** Pairwise gross obligations, collapsed per (from,to) direction. */
export function computePairwiseObligations(entries: LedgerEntry[]): { fromPlayerId: PlayerId; toPlayerId: PlayerId; amountCents: number }[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.status === "REVERSED") continue;
    const key = `${e.fromPlayerId}->${e.toPlayerId}`;
    map.set(key, (map.get(key) ?? 0) + e.amountCents);
  }
  return [...map.entries()].map(([key, amountCents]) => {
    const [fromPlayerId, toPlayerId] = key.split("->");
    return { fromPlayerId, toPlayerId, amountCents };
  });
}

/** Sanity check required by the spec: a closed set of ledger entries nets to zero. */
export function balancesSum(balances: NetBalances): number {
  return Object.values(balances).reduce((a, b) => a + b, 0);
}
