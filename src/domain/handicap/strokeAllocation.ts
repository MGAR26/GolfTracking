import type { HoleInfo, StrokeAllocation } from "../types";

/**
 * How strokes are removed for a plus (negative) handicap.
 * WHS gives strokes back on the easiest holes first (highest stroke index).
 */
export type NegativeHandicapPolicy = "HIGHEST_STROKE_INDEX_FIRST" | "LOWEST_STROKE_INDEX_FIRST";

export interface AllocateStrokesOptions {
  negativePolicy?: NegativeHandicapPolicy;
}

/**
 * Allocate a playing handicap across holes by stroke index.
 *
 * Positive N: one stroke on stroke-index holes 1..N; above the hole count, a second stroke
 * begins again at stroke index 1, and so on.
 * Negative N: remove one stroke per hole starting from the policy's end of the stroke index.
 */
export function allocateStrokes(
  playingHandicap: number,
  holes: Pick<HoleInfo, "holeNumber" | "strokeIndex">[],
  options: AllocateStrokesOptions = {},
): StrokeAllocation {
  if (!Number.isInteger(playingHandicap)) throw new Error("playingHandicap must be an integer");
  const policy = options.negativePolicy ?? "HIGHEST_STROKE_INDEX_FIRST";
  const count = holes.length;
  const allocation: StrokeAllocation = {};
  for (const h of holes) allocation[h.holeNumber] = 0;
  if (count === 0 || playingHandicap === 0) return allocation;

  const ordered = [...holes].sort((a, b) => a.strokeIndex - b.strokeIndex);
  // Rank each hole 1..count within this set so 9-hole subsets still allocate sensibly.
  const rank = new Map<number, number>();
  ordered.forEach((h, i) => rank.set(h.holeNumber, i + 1));

  if (playingHandicap > 0) {
    const full = Math.floor(playingHandicap / count);
    const remainder = playingHandicap % count;
    for (const h of holes) {
      const r = rank.get(h.holeNumber)!;
      allocation[h.holeNumber] = full + (r <= remainder ? 1 : 0);
    }
    return allocation;
  }

  const strokesToRemove = -playingHandicap;
  const full = Math.floor(strokesToRemove / count);
  const remainder = strokesToRemove % count;
  for (const h of holes) {
    const r = rank.get(h.holeNumber)!;
    const inRemainder =
      policy === "HIGHEST_STROKE_INDEX_FIRST" ? r > count - remainder : r <= remainder;
    allocation[h.holeNumber] = 0 - (full + (inRemainder ? 1 : 0));
  }
  return allocation;
}

export function netHoleScore(grossScore: number, allocatedStrokes: number): number {
  return grossScore - allocatedStrokes;
}

export function totalAllocated(allocation: StrokeAllocation): number {
  return Object.values(allocation).reduce((a, b) => a + b, 0);
}
