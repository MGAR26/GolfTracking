import type { HoleEntry, HoleInfo, PlayerId, StrokeAllocation } from "../types";
import { netHoleScore } from "../handicap/strokeAllocation";

export interface HoleLine {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  strokesReceived: number;
  gross: number | null;
  net: number | null;
  /** gross - par, null if not entered */
  grossToPar: number | null;
  netToPar: number | null;
}

export interface SegmentTotals {
  holesPlayed: number;
  par: number;
  gross: number;
  net: number;
  grossToPar: number;
  netToPar: number;
}

export interface PlayerRoundTotals {
  playerId: PlayerId;
  holes: HoleLine[];
  out: SegmentTotals;
  in: SegmentTotals;
  total: SegmentTotals;
  holesPlayed: number;
  isComplete: boolean;
  strokesReceived: number;
}

function segment(lines: HoleLine[]): SegmentTotals {
  const played = lines.filter((l) => l.gross !== null);
  const par = played.reduce((a, l) => a + l.par, 0);
  const gross = played.reduce((a, l) => a + (l.gross ?? 0), 0);
  const net = played.reduce((a, l) => a + (l.net ?? 0), 0);
  return {
    holesPlayed: played.length,
    par,
    gross,
    net,
    grossToPar: gross - par,
    netToPar: net - par,
  };
}

/**
 * Pure projection of a player's round from raw hole entries + stroke allocation.
 * "Out" is the first half of the hole list, "In" the second half (9/9 for 18 holes).
 */
export function computePlayerRoundTotals(
  playerId: PlayerId,
  holes: HoleInfo[],
  allocation: StrokeAllocation,
  entries: HoleEntry[],
): PlayerRoundTotals {
  const byHole = new Map<number, HoleEntry>();
  for (const e of entries) if (e.playerId === playerId) byHole.set(e.holeNumber, e);
  const sorted = [...holes].sort((a, b) => a.holeNumber - b.holeNumber);

  const lines: HoleLine[] = sorted.map((h) => {
    const entry = byHole.get(h.holeNumber);
    const strokes = allocation[h.holeNumber] ?? 0;
    const gross = entry?.grossScore ?? null;
    const net = gross === null ? null : netHoleScore(gross, strokes);
    return {
      holeNumber: h.holeNumber,
      par: h.par,
      strokeIndex: h.strokeIndex,
      strokesReceived: strokes,
      gross,
      net,
      grossToPar: gross === null ? null : gross - h.par,
      netToPar: net === null ? null : net - h.par,
    };
  });

  const half = Math.ceil(lines.length / 2);
  const front = lines.slice(0, half);
  const back = lines.slice(half);
  const total = segment(lines);
  return {
    playerId,
    holes: lines,
    out: segment(front),
    in: segment(back),
    total,
    holesPlayed: total.holesPlayed,
    isComplete: total.holesPlayed === lines.length && lines.length > 0,
    strokesReceived: Object.values(allocation).reduce((a, b) => a + b, 0),
  };
}

export type ScoreLabel = "ALBATROSS" | "EAGLE" | "BIRDIE" | "PAR" | "BOGEY" | "DOUBLE" | "TRIPLE_PLUS";

export function classifyScore(toPar: number): ScoreLabel {
  if (toPar <= -3) return "ALBATROSS";
  if (toPar === -2) return "EAGLE";
  if (toPar === -1) return "BIRDIE";
  if (toPar === 0) return "PAR";
  if (toPar === 1) return "BOGEY";
  if (toPar === 2) return "DOUBLE";
  return "TRIPLE_PLUS";
}

export function formatToPar(toPar: number): string {
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}
