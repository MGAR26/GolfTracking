import { describe, expect, it } from "vitest";
import { allocateStrokes, calculateCourseHandicap, calculatePlayingHandicap, netHoleScore, relativeHandicaps, roundHalfUp, totalAllocated } from "@/domain/handicap";
import { course18 } from "./fixtures";

describe("roundHalfUp", () => {
  it("rounds .5 up toward positive infinity", () => {
    expect(roundHalfUp(12.5)).toBe(13);
    expect(roundHalfUp(12.49)).toBe(12);
    expect(roundHalfUp(-2.5)).toBe(-2);
    expect(roundHalfUp(-2.51)).toBe(-3);
  });
});

describe("calculateCourseHandicap", () => {
  const course = { slopeRating: 135, courseRating: 72.4, par: 72 };
  it("positive index (seed players)", () => {
    expect(calculateCourseHandicap({ handicapIndex: 5.2, ...course }).courseHandicap).toBe(7); // 6.21+0.4=6.61
    expect(calculateCourseHandicap({ handicapIndex: 11.4, ...course }).courseHandicap).toBe(14); // 13.62+0.4
    expect(calculateCourseHandicap({ handicapIndex: 8.7, ...course }).courseHandicap).toBe(11); // 10.39+0.4
    expect(calculateCourseHandicap({ handicapIndex: 14.1, ...course }).courseHandicap).toBe(17); // 16.85+0.4
  });
  it("zero index still gets rating-par adjustment", () => {
    expect(calculateCourseHandicap({ handicapIndex: 0, slopeRating: 113, courseRating: 74.0, par: 72 }).courseHandicap).toBe(2);
  });
  it("high index", () => {
    expect(calculateCourseHandicap({ handicapIndex: 36.0, slopeRating: 140, courseRating: 75.0, par: 72 }).courseHandicap).toBe(48); // 44.6+3=47.6
  });
  it("negative (plus) index", () => {
    expect(calculateCourseHandicap({ handicapIndex: -3.0, slopeRating: 113, courseRating: 70.0, par: 72 }).courseHandicap).toBe(-5);
  });
  it("stores raw value", () => {
    expect(calculateCourseHandicap({ handicapIndex: 10, slopeRating: 113, courseRating: 72, par: 72 }).raw).toBeCloseTo(10);
  });
});

describe("calculatePlayingHandicap", () => {
  it("applies allowance and rounds", () => {
    expect(calculatePlayingHandicap(17, 100)).toBe(17);
    expect(calculatePlayingHandicap(17, 95)).toBe(16); // 16.15
    expect(calculatePlayingHandicap(15, 90)).toBe(14); // 13.5 -> 14
  });
});

describe("relativeHandicaps", () => {
  it("lowest plays off zero", () => {
    expect(relativeHandicaps({ a: 7, b: 14, c: 11 })).toEqual({ a: 0, b: 7, c: 4 });
  });
});

describe("allocateStrokes", () => {
  const holes = course18();
  const byIndex = (alloc: Record<number, number>, si: number) => alloc[holes.find((h) => h.strokeIndex === si)!.holeNumber];

  it("0 handicap gets no strokes", () => {
    const a = allocateStrokes(0, holes);
    expect(totalAllocated(a)).toBe(0);
  });
  it("5 handicap: one stroke on SI 1-5", () => {
    const a = allocateStrokes(5, holes);
    expect(totalAllocated(a)).toBe(5);
    for (let si = 1; si <= 18; si++) expect(byIndex(a, si)).toBe(si <= 5 ? 1 : 0);
  });
  it("18 handicap: one stroke every hole", () => {
    const a = allocateStrokes(18, holes);
    expect(Object.values(a).every((v) => v === 1)).toBe(true);
  });
  it("23 handicap: two strokes on SI 1-5, one elsewhere", () => {
    const a = allocateStrokes(23, holes);
    expect(totalAllocated(a)).toBe(23);
    for (let si = 1; si <= 18; si++) expect(byIndex(a, si)).toBe(si <= 5 ? 2 : 1);
  });
  it("36 handicap: two strokes every hole", () => {
    const a = allocateStrokes(36, holes);
    expect(Object.values(a).every((v) => v === 2)).toBe(true);
  });
  it("negative handicap removes strokes from highest stroke index first (WHS)", () => {
    const a = allocateStrokes(-3, holes);
    expect(totalAllocated(a)).toBe(-3);
    for (let si = 1; si <= 18; si++) expect(byIndex(a, si)).toBe(si >= 16 ? -1 : 0);
  });
  it("negative handicap with lowest-index-first policy", () => {
    const a = allocateStrokes(-2, holes, { negativePolicy: "LOWEST_STROKE_INDEX_FIRST" });
    for (let si = 1; si <= 18; si++) expect(byIndex(a, si)).toBe(si <= 2 ? -1 : 0);
  });
  it("9-hole subset allocates within the subset", () => {
    const front = holes.slice(0, 9);
    const a = allocateStrokes(4, front);
    expect(totalAllocated(a)).toBe(4);
    const lowestFour = [...front].sort((x, y) => x.strokeIndex - y.strokeIndex).slice(0, 4).map((h) => h.holeNumber);
    for (const h of front) expect(a[h.holeNumber]).toBe(lowestFour.includes(h.holeNumber) ? 1 : 0);
  });
  it("rejects non-integer handicaps", () => {
    expect(() => allocateStrokes(4.5, holes)).toThrow();
  });
});

describe("netHoleScore", () => {
  it("subtracts allocated strokes across every stroke index position", () => {
    const holes = course18();
    const a = allocateStrokes(23, holes);
    for (const h of holes) {
      const expected = h.strokeIndex <= 5 ? 2 : 1;
      expect(netHoleScore(5, a[h.holeNumber])).toBe(5 - expected);
    }
    expect(netHoleScore(4, -1)).toBe(5);
  });
});
