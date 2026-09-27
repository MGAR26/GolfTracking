"use client";

import type { HoleScorePatch } from "@/server/services/scoreService";

/**
 * Local queue of hole-score saves that could not reach the server. Coalesced per
 * (round, player, hole) so replay sends one request with the merged patch. Stored in
 * localStorage (small payloads, synchronous, survives reloads); swap for IndexedDB if
 * the queue ever needs to hold more than a few hundred entries.
 */
export interface QueuedSave {
  /** Also used as client_event_id for idempotent replay. */
  id: string;
  roundId: string;
  playerId: string;
  holeNumber: number;
  patch: HoleScorePatch;
  expectedVersion: number;
  queuedAt: string;
  status: "pending" | "conflict" | "error";
  message?: string;
}

const KEY = "gto:score-queue:v1";
type Listener = (items: QueuedSave[]) => void;
const listeners = new Set<Listener>();
const EMPTY: QueuedSave[] = [];
/** Cached snapshot so useSyncExternalStore gets a stable reference between writes. */
let cache: QueuedSave[] | null = null;

function read(): QueuedSave[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as QueuedSave[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: QueuedSave[]): void {
  cache = items;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable: queue lives in memory for this page only */
  }
  for (const l of listeners) l(items);
}

export const offlineQueue = {
  list: read,
  /** Server-side snapshot for useSyncExternalStore. */
  serverSnapshot: (): QueuedSave[] => EMPTY,
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Add or merge a save. Returns the queue entry id (client_event_id). */
  enqueue(item: Omit<QueuedSave, "id" | "queuedAt" | "status">): string {
    const items = read();
    const existing = items.find((q) => q.roundId === item.roundId && q.playerId === item.playerId && q.holeNumber === item.holeNumber && q.status === "pending");
    if (existing) {
      write(items.map((q) => (q.id === existing.id ? { ...q, patch: { ...q.patch, ...item.patch } } : q)));
      return existing.id;
    }
    const entry: QueuedSave = { ...item, id: crypto.randomUUID(), queuedAt: new Date().toISOString(), status: "pending" };
    write([...items, entry]);
    return entry.id;
  },
  update(id: string, patch: Partial<QueuedSave>): void {
    write(read().map((q) => (q.id === id ? { ...q, ...patch } : q)));
  },
  remove(id: string): void {
    write(read().filter((q) => q.id !== id));
  },
  find(roundId: string, playerId: string, holeNumber: number): QueuedSave | undefined {
    return read().find((q) => q.roundId === roundId && q.playerId === playerId && q.holeNumber === holeNumber);
  },
  clear(): void {
    write([]);
  },
};

/** True when the failure looks like a network problem rather than a server rejection. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|Failed to fetch|Load failed|ECONN|timeout/i.test(msg);
}
