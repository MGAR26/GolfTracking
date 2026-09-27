/**
 * Shared domain primitives. This package must stay free of React / Next / DB imports
 * so it can later be consumed by a native shell unchanged.
 */

export type PlayerId = string;

export interface HoleInfo {
  holeNumber: number;
  par: number;
  yardage: number | null;
  strokeIndex: number;
}

export type FairwayResult = "HIT" | "LEFT" | "RIGHT" | "SHORT" | "LONG";

/** Raw, user-entered hole data. `null` means "not entered" and must never be inferred. */
export interface HoleEntry {
  playerId: PlayerId;
  holeNumber: number;
  grossScore: number | null;
  putts: number | null;
  fairwayResult: FairwayResult | null;
  gir: boolean | null;
  penaltyStrokes: number;
  obStrokes: number;
  sandAttempt: boolean | null;
  sandSave: boolean | null;
  upDownAttempt: boolean | null;
  upDown: boolean | null;
  driveDistance: number | null;
}

export function emptyHoleEntry(playerId: PlayerId, holeNumber: number): HoleEntry {
  return {
    playerId,
    holeNumber,
    grossScore: null,
    putts: null,
    fairwayResult: null,
    gir: null,
    penaltyStrokes: 0,
    obStrokes: 0,
    sandAttempt: null,
    sandSave: null,
    upDownAttempt: null,
    upDown: null,
    driveDistance: null,
  };
}

/** Strokes allocated per hole number for one player. */
export type StrokeAllocation = Record<number, number>;

export interface RoundPlayerInfo {
  playerId: PlayerId;
  displayName: string;
  handicapIndex: number;
  courseHandicap: number;
  /** Strokes received per hole, derived from the game-specific playing handicap. */
  allocation: StrokeAllocation;
}

export type ScoringBasis = "GROSS" | "NET";
