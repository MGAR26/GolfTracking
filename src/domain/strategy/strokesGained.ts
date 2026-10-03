/**
 * Strokes gained: how many strokes a shot saved or cost against a benchmark golfer.
 *
 *   gained = E(before) − E(after) − 1 − penalties
 *
 * where E is the expected strokes to hole out (expectedStrokes.ts). The benchmark is the
 * golfer of `handicapIndex` (0 = scratch), so a +0.3 means "better than a player of that
 * handicap usually does from there". Planned-vs-actual compares what the chosen play promised
 * (its expected strokes from here) with what the shot actually left. Versioned with the table.
 */
import { EXPECTED_STROKES_VERSION, expectedStrokes, type ExpectedLie } from "./expectedStrokes";

export const STROKES_GAINED_VERSION = `sg-v1/${EXPECTED_STROKES_VERSION}`;

export type SgCategory = "tee" | "approach" | "around" | "putting";
export const SG_CATEGORIES: { key: SgCategory; label: string }[] = [
  { key: "tee", label: "Off the tee" },
  { key: "approach", label: "Approach" },
  { key: "around", label: "Around the green" },
  { key: "putting", label: "Putting" },
];

export interface SgShotInput {
  startDistanceYards: number;
  startLie: ExpectedLie;
  endDistanceYards: number;
  endLie: ExpectedLie;
  holed: boolean;
  penaltyStrokes?: number;
  /** Expected strokes the chosen play promised from here (1 + its average leave), if one was picked. */
  plannedExpected?: number | null;
}
export interface SgShot {
  category: SgCategory;
  /** Expected strokes from where the shot started, against the benchmark. */
  before: number;
  /** Expected strokes from where it finished (0 once holed). */
  after: number;
  gained: number;
  /** Plan minus actual (1 + after): positive beat the plan. Null when no play was chosen. */
  planDelta: number | null;
}
export interface SgTotals { total: number; byCategory: Record<SgCategory, number>; shotsByCategory: Record<SgCategory, number>; shots: number; planned: { shots: number; delta: number } }

const emptyByCategory = (): Record<SgCategory, number> => ({ tee: 0, approach: 0, around: 0, putting: 0 });

/** Broadie's split: tee shots on par 4s and 5s, approaches from 100+ (par-3 tee shots included), short game inside 100, putts. */
export function sgCategory(shot: SgShotInput, isFirstShot: boolean, par: number): SgCategory {
  if (shot.startLie === "green") return "putting";
  if (isFirstShot && par >= 4) return "tee";
  return shot.startDistanceYards >= 100 ? "approach" : "around";
}

export function strokesGainedForShot(shot: SgShotInput, isFirstShot: boolean, par: number, handicapIndex: number, planBaselineHandicap = handicapIndex): SgShot {
  const before = expectedStrokes({ distanceYards: shot.startDistanceYards, lie: shot.startLie, handicapIndex });
  const after = shot.holed ? 0 : expectedStrokes({ distanceYards: shot.endDistanceYards, lie: shot.endLie, handicapIndex });
  const gained = before - after - 1 - (shot.penaltyStrokes ?? 0);
  let planDelta: number | null = null;
  if (shot.plannedExpected !== undefined && shot.plannedExpected !== null) {
    // the plan was priced against the player's own handicap, so judge it on that scale whatever the display baseline
    const actual = shot.holed ? 1 : 1 + expectedStrokes({ distanceYards: shot.endDistanceYards, lie: shot.endLie, handicapIndex: planBaselineHandicap });
    planDelta = shot.plannedExpected - actual;
  }
  return { category: sgCategory(shot, isFirstShot, par), before, after, gained, planDelta };
}

/** Every shot on a hole in order. The sum equals E(tee) − strokes taken once the ball is holed. */
export function strokesGainedForHole(shots: SgShotInput[], par: number, handicapIndex: number, planBaselineHandicap = handicapIndex): { shots: SgShot[]; totals: SgTotals } {
  const out = shots.map((s, i) => strokesGainedForShot(s, i === 0, par, handicapIndex, planBaselineHandicap));
  return { shots: out, totals: sumStrokesGained(out) };
}

export function sumStrokesGained(shots: SgShot[]): SgTotals {
  const byCategory = emptyByCategory(), shotsByCategory = emptyByCategory();
  let total = 0, plannedShots = 0, plannedDelta = 0;
  for (const s of shots) {
    byCategory[s.category] += s.gained;
    shotsByCategory[s.category] += 1;
    total += s.gained;
    if (s.planDelta !== null) { plannedShots += 1; plannedDelta += s.planDelta; }
  }
  return { total, byCategory, shotsByCategory, shots: shots.length, planned: { shots: plannedShots, delta: plannedDelta } };
}

export function mergeStrokesGained(parts: SgTotals[]): SgTotals {
  const byCategory = emptyByCategory(), shotsByCategory = emptyByCategory();
  let total = 0, shots = 0, plannedShots = 0, plannedDelta = 0;
  for (const p of parts) {
    for (const k of Object.keys(byCategory) as SgCategory[]) { byCategory[k] += p.byCategory[k]; shotsByCategory[k] += p.shotsByCategory[k]; }
    total += p.total; shots += p.shots; plannedShots += p.planned.shots; plannedDelta += p.planned.delta;
  }
  return { total, byCategory, shotsByCategory, shots, planned: { shots: plannedShots, delta: plannedDelta } };
}
