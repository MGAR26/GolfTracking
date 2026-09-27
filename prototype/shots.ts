/**
 * Shot-by-shot tracking. A shot is "where the ball started" → "where it came to rest".
 * The score is derived: shots + putts + penalties, so a tracked hole never needs a score typed.
 */
import type { Pt } from "./holeGeometry";
import { dist } from "./holeGeometry";

export const CLUBS = ["Dr", "3W", "5W", "Hy", "4i", "5i", "6i", "7i", "8i", "9i", "PW", "GW", "SW", "LW"] as const;
export type Club = (typeof CLUBS)[number];
export type Shape = "draw" | "straight" | "fade";
export type Trajectory = "low" | "normal" | "high";
export type Lie = "tee" | "fairway" | "rough" | "sand" | "fringe" | "green";

export interface Shot {
  id: string;
  playerId: string;
  holeNumber: number;
  seq: number;
  club: Club | "chip";
  from: Pt;
  to: Pt;
  distance: number;
  shape: Shape | null;
  trajectory: Trajectory | null;
  lie: Lie | null;
}

/** Typical distances used until a player has history; overridden by their logged shots. */
export const DEFAULT_CARRY: Record<Club, number> = { Dr: 250, "3W": 225, "5W": 210, Hy: 195, "4i": 185, "5i": 175, "6i": 165, "7i": 155, "8i": 145, "9i": 135, PW: 120, GW: 105, SW: 90, LW: 70 };

/** Per-club average from a player's logged shots (median so one thin shot doesn't drag it). */
export function bagAverages(shots: Shot[], playerId: string): Partial<Record<Club, { avg: number; n: number }>> {
  const out: Partial<Record<Club, { avg: number; n: number }>> = {};
  for (const club of CLUBS) {
    const ds = shots.filter((s) => s.playerId === playerId && s.club === club).map((s) => s.distance).sort((a, b) => a - b);
    if (ds.length === 0) continue;
    const mid = Math.floor(ds.length / 2);
    out[club] = { avg: ds.length % 2 ? ds[mid] : (ds[mid - 1] + ds[mid]) / 2, n: ds.length };
  }
  return out;
}

/** Best guess at the club for a distance: nearest by the player's own numbers, else defaults. */
export function suggestClub(distance: number, shots: Shot[], playerId: string): Club | "chip" {
  if (distance < 30) return "chip";
  const bag = bagAverages(shots, playerId);
  let best: Club = "7i", bestDiff = Infinity;
  for (const club of CLUBS) {
    const d = bag[club]?.avg ?? DEFAULT_CARRY[club];
    const diff = Math.abs(d - distance);
    if (diff < bestDiff) { best = club; bestDiff = diff; }
  }
  return best;
}

export function shotFrom(prev: Pt, to: Pt, playerId: string, holeNumber: number, seq: number, shots: Shot[]): Omit<Shot, "id"> {
  const distance = dist(prev, to);
  return { playerId, holeNumber, seq, club: suggestClub(distance, shots, playerId), from: prev, to, distance, shape: null, trajectory: null, lie: null };
}
