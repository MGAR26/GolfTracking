/**
 * Two-side match play evaluator shared by Match Play and Nassau.
 * A "side" is one or more players; multi-player sides use best ball per hole.
 */

export type HoleOutcome = "A" | "B" | "HALF";

export interface MatchState {
  /** Positive = side A up, negative = side B up. */
  diff: number;
  holesPlayed: number;
  holesRemaining: number;
  /** Set once a side has clinched or the segment completed. */
  closed: boolean;
  winner: "A" | "B" | null;
  /** Hole-by-hole record for the audit trail. */
  outcomes: { holeNumber: number; outcome: HoleOutcome; diffAfter: number }[];
  /** e.g. "2 UP", "AS", "3&2", "1 UP" (final) */
  status: string;
  dormie: boolean;
}

export function initialMatch(totalHoles: number): MatchState {
  return {
    diff: 0,
    holesPlayed: 0,
    holesRemaining: totalHoles,
    closed: false,
    winner: null,
    outcomes: [],
    status: "AS",
    dormie: false,
  };
}

export function describeStatus(diff: number, remaining: number, closed: boolean, wonEarly: boolean): string {
  if (closed) {
    if (diff === 0) return "HALVED";
    const lead = Math.abs(diff);
    // Standard notation when won with holes to spare: "3&2"
    return wonEarly && remaining > 0 ? `${lead}&${remaining}` : `${lead} UP`;
  }
  if (diff === 0) return "AS";
  return `${Math.abs(diff)} UP`;
}

export function applyHole(state: MatchState, holeNumber: number, outcome: HoleOutcome): MatchState {
  if (state.closed) return state;
  const diff = state.diff + (outcome === "A" ? 1 : outcome === "B" ? -1 : 0);
  const holesPlayed = state.holesPlayed + 1;
  const holesRemaining = state.holesRemaining - 1;
  const lead = Math.abs(diff);
  const wonEarly = lead > holesRemaining && holesRemaining > 0;
  const closed = wonEarly || holesRemaining === 0;
  const winner = closed && diff !== 0 ? (diff > 0 ? "A" : "B") : null;
  const dormie = !closed && lead === holesRemaining && lead > 0;
  return {
    diff,
    holesPlayed,
    holesRemaining,
    closed,
    winner,
    outcomes: [...state.outcomes, { holeNumber, outcome, diffAfter: diff }],
    status: describeStatus(diff, holesRemaining, closed, wonEarly),
    dormie,
  };
}

export function outcomeFromScores(a: number | null, b: number | null): HoleOutcome | null {
  if (a === null || b === null) return null;
  if (a < b) return "A";
  if (b < a) return "B";
  return "HALF";
}

/** Best (lowest) score among a side's players; null if any is missing. */
export function sideBestScore(scores: (number | null)[]): number | null {
  if (scores.length === 0 || scores.some((s) => s === null)) return null;
  return Math.min(...(scores as number[]));
}
