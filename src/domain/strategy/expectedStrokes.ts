/**
 * Expected strokes to hole out from a distance and lie. Framework-free so the on-course
 * strategy card, the stats, and later strokes-gained all share one benchmark.
 *
 * Baseline is a scratch golfer, shaped after the public Broadie-style tables; each value is
 * interpolated between anchor distances. A handicap multiplier stretches the shot-making part
 * (not the 1 stroke you always spend) so a 15 handicap averages roughly par + 0.8 per hole.
 * Versioned so stored results can say which table produced them.
 */
export const EXPECTED_STROKES_VERSION = "scratch-anchor-v1";

export type ExpectedLie = "tee" | "fairway" | "rough" | "sand" | "green" | "water";

// [distance in yards, expected strokes] anchors for a scratch golfer
const TEE_FAIRWAY: [number, number][] = [[0, 1.0], [10, 2.2], [20, 2.4], [40, 2.6], [60, 2.7], [80, 2.78], [100, 2.85], [120, 2.9], [140, 2.95], [160, 3.0], [180, 3.08], [200, 3.17], [225, 3.3], [250, 3.42], [275, 3.55], [300, 3.68], [350, 3.85], [400, 4.0], [450, 4.15], [500, 4.33], [600, 4.7]];
const ROUGH_EXTRA: [number, number][] = [[0, 0.1], [20, 0.25], [50, 0.3], [100, 0.3], [150, 0.28], [200, 0.27], [300, 0.25], [600, 0.25]];
const SAND_EXTRA: [number, number][] = [[0, 0.3], [20, 0.5], [40, 0.55], [80, 0.5], [150, 0.45], [600, 0.45]];
// putting anchors in feet
const PUTT: [number, number][] = [[0, 1.0], [2, 1.02], [3, 1.05], [5, 1.2], [8, 1.45], [10, 1.6], [15, 1.78], [20, 1.9], [30, 2.05], [40, 2.2], [60, 2.42], [90, 2.65], [150, 3.0]];

function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) { const [x0, y0] = table[i - 1]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  }
  return table[table.length - 1][1];
}

export interface ExpectedStrokesInput { distanceYards: number; lie: ExpectedLie; handicapIndex?: number }

/** Strokes a golfer of that handicap needs, on average, from here. */
export function expectedStrokes({ distanceYards, lie, handicapIndex = 0 }: ExpectedStrokesInput): number {
  const d = Math.max(0, distanceYards);
  const hcp = Math.max(-5, Math.min(36, handicapIndex));
  if (lie === "green") {
    const putts = interp(PUTT, d * 3);
    return 1 + (putts - 1) * (1 + hcp * 0.006);
  }
  let base = interp(TEE_FAIRWAY, d);
  if (lie === "rough") base += interp(ROUGH_EXTRA, d);
  if (lie === "sand") base += interp(SAND_EXTRA, d);
  if (lie === "water") base = 1 + interp(TEE_FAIRWAY, d) + interp(ROUGH_EXTRA, d) * 0.5; // penalty stroke, then play on
  // stretch everything beyond the first stroke: a 15 handicap is about 20% worse on a full hole
  return 1 + (base - 1) * (1 + hcp * 0.013);
}
