import { describe, expect, it } from "vitest";
import { DEFAULT_CONDITIONS, elevationAt, playsLike, type HoleConditions } from "../../prototype/holeGeometry";
import pinehurst4 from "../../prototype/courses/pinehurst-4.json";

const profile = [{ u: 0, ft: 500 }, { u: 100, ft: 520 }, { u: 200, ft: 490 }];
const cond: HoleConditions = { bearingDeg: 0, elevationFt: -10, tilt: { u: -1, v: 0, pct: 2 } };
const calm = { mph: 0, fromDeg: 0 };

describe("measured elevation", () => {
  it("interpolates along the profile and clamps at the ends", () => {
    expect(elevationAt(profile, -5)).toBe(500);
    expect(elevationAt(profile, 50)).toBe(510);
    expect(elevationAt(profile, 150)).toBe(505);
    expect(elevationAt(profile, 999)).toBe(490);
  });
  it("plays-like uses the measured climb from here to the green, not the straight-line guess", () => {
    const pl = playsLike({ u: 50, v: 0 }, { u: 200, v: 0 }, 200, cond, calm, DEFAULT_CONDITIONS, profile);
    expect(pl.elevationRemainingFt).toBe(490 - 510);
    expect(pl.elevationAdj).toBeCloseTo(-20 / 3);
    expect(pl.confidence).toBe("medium"); // measured elevation, manual wind
    const guessed = playsLike({ u: 50, v: 0 }, { u: 200, v: 0 }, 200, cond, calm);
    expect(guessed.elevationRemainingFt).toBeCloseTo(-7.5);
    expect(guessed.confidence).toBe("low");
  });
  it("every bundled Pinehurst hole carries a measured profile and a registered photo", () => {
    const holes = Object.values(pinehurst4.holes) as { length: number; elevation?: { u: number; ft: number }[]; photo?: { u0: number; u1: number; v0: number; v1: number; src: string } }[];
    expect(holes).toHaveLength(18);
    for (const h of holes) {
      expect(h.elevation!.length).toBeGreaterThan(5);
      expect(h.elevation![h.elevation!.length - 1].u).toBe(Math.round(h.length));
      expect(h.photo!.u0).toBeLessThan(0);
      expect(h.photo!.u1).toBeGreaterThan(h.length);
      expect(h.photo!.src).toMatch(/^courses\/pinehurst-4\/h\d+\.jpg$/);
    }
  });
});
