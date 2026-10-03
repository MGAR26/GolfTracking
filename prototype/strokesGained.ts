/**
 * Strokes gained for tracked shots: turns the prototype's Shot rows (frame coordinates, lies)
 * into the domain service's inputs. A shot starts where the previous one came to rest, so its
 * starting lie is the previous shot's lie (the tee for the first, the green for every putt).
 */
import type { Pt } from "./holeGeometry";
import { dist } from "./holeGeometry";
import type { Shot } from "./shots";
import type { ExpectedLie } from "../src/domain/strategy/expectedStrokes";
import { mergeStrokesGained, strokesGainedForHole, type SgShot, type SgShotInput, type SgTotals } from "../src/domain/strategy/strokesGained";

export type SgBaseline = "handicap" | "scratch";

const asExpectedLie = (lie: Shot["lie"], fallback: ExpectedLie): ExpectedLie => (lie === "fringe" ? "fairway" : lie ?? fallback);

export function sgInputs(shots: Shot[], flag: Pt): SgShotInput[] {
  return shots.map((s, i) => {
    const prev = i > 0 ? shots[i - 1] : null;
    const startLie: ExpectedLie = s.club === "putt" ? "green" : !prev ? "tee" : asExpectedLie(prev.lie, prev.club === "putt" ? "green" : "fairway");
    const holed = !!s.holed;
    return {
      startDistanceYards: dist(s.from, flag),
      startLie,
      endDistanceYards: holed ? 0 : dist(s.to, flag),
      endLie: holed ? "green" : asExpectedLie(s.lie, "fairway"),
      holed,
      plannedExpected: s.plan?.expected ?? null,
    };
  });
}

/** Per-shot strokes gained for one hole, keyed by shot id, plus the hole's totals. */
export function holeStrokesGained(shots: Shot[], flag: Pt, par: number, handicapIndex: number, baseline: SgBaseline): { byId: Record<string, SgShot>; totals: SgTotals } {
  const r = strokesGainedForHole(sgInputs(shots, flag), par, baseline === "scratch" ? 0 : handicapIndex, handicapIndex);
  const byId: Record<string, SgShot> = {};
  shots.forEach((s, i) => { byId[s.id] = r.shots[i]; });
  return { byId, totals: r.totals };
}

/** Round totals over every hole the player tracked. */
export function roundStrokesGained(holes: { shots: Shot[]; flag: Pt; par: number }[], handicapIndex: number, baseline: SgBaseline): SgTotals {
  return mergeStrokesGained(holes.filter((h) => h.shots.length > 0).map((h) => holeStrokesGained(h.shots, h.flag, h.par, handicapIndex, baseline).totals));
}

export const fmtSg = (n: number, digits = 1) => (Math.abs(n) < 0.05 ? "0.0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`);
