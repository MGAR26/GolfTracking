import { roundHalfUp } from "./rounding";

export interface CourseHandicapInput {
  handicapIndex: number;
  slopeRating: number;
  courseRating: number;
  par: number;
}

export interface CourseHandicapResult {
  /** Unrounded value, stored for auditability. */
  raw: number;
  courseHandicap: number;
}

/**
 * courseHandicap = round(handicapIndex * (slopeRating / 113) + (courseRating - par))
 */
export function calculateCourseHandicap(input: CourseHandicapInput): CourseHandicapResult {
  const { handicapIndex, slopeRating, courseRating, par } = input;
  if (!Number.isFinite(handicapIndex)) throw new Error("handicapIndex must be a number");
  if (slopeRating < 55 || slopeRating > 155) throw new Error("slopeRating must be between 55 and 155");
  const raw = handicapIndex * (slopeRating / 113) + (courseRating - par);
  return { raw, courseHandicap: roundHalfUp(raw) };
}

/**
 * playingHandicap = round(courseHandicap * allowancePercent / 100)
 * Allowance is configured per game (e.g. 100 for stroke play, 95 for four-ball).
 */
export function calculatePlayingHandicap(courseHandicap: number, allowancePercent = 100): number {
  if (allowancePercent < 0 || allowancePercent > 200) throw new Error("allowancePercent out of range");
  return roundHalfUp((courseHandicap * allowancePercent) / 100);
}

/**
 * For head-to-head play, the lowest handicap plays off zero and the others receive the difference.
 */
export function relativeHandicaps<T extends string>(handicaps: Record<T, number>): Record<T, number> {
  const values = Object.values(handicaps) as number[];
  if (values.length === 0) return { ...handicaps };
  const min = Math.min(...values);
  const out = {} as Record<T, number>;
  for (const key of Object.keys(handicaps) as T[]) out[key] = handicaps[key] - min;
  return out;
}
