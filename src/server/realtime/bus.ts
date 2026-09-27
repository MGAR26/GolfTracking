import { EventEmitter } from "node:events";

/**
 * In-process change bus. Services publish after a commit; the SSE route fans out to
 * connected phones. This covers a single Node instance (local PGlite dev, one hosted
 * server). Multi-instance deployments should swap `publish` for Supabase Realtime /
 * Postgres NOTIFY without touching callers.
 */
export type RoundChange =
  | { type: "score"; roundId: string; playerId: string; holeNumber: number; version: number; actorId: string; at: string }
  | { type: "side_bet"; roundId: string; sideBetId: string; actorId: string; at: string }
  | { type: "round"; roundId: string; status: string; actorId: string | null; at: string }
  | { type: "conflict"; roundId: string; conflictId: string; actorId: string; at: string };

interface BusGlobal {
  __golfBus?: EventEmitter;
}
const g = globalThis as unknown as BusGlobal;

function bus(): EventEmitter {
  if (!g.__golfBus) {
    g.__golfBus = new EventEmitter();
    g.__golfBus.setMaxListeners(0);
  }
  return g.__golfBus;
}

export function publishRoundChange(change: RoundChange): void {
  bus().emit(`round:${change.roundId}`, change);
}

export function subscribeRound(roundId: string, listener: (change: RoundChange) => void): () => void {
  const b = bus();
  const key = `round:${roundId}`;
  b.on(key, listener);
  return () => b.off(key, listener);
}
