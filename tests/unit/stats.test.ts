import { describe, expect, it } from "vitest";
import { computeRoundStats } from "@/domain/stats";
import { emptyHoleEntry } from "@/domain/types";
import { course18 } from "./fixtures";

describe("computeRoundStats", () => {
  const holes = course18();
  it("does not infer missing data", () => {
    const entries = [
      { ...emptyHoleEntry("a", 1), grossScore: 4, fairwayResult: "HIT" as const, gir: true, putts: 2 },
      { ...emptyHoleEntry("a", 2), grossScore: 5, fairwayResult: "LEFT" as const, gir: null, putts: null },
      { ...emptyHoleEntry("a", 3), grossScore: 2, fairwayResult: null, gir: true, putts: 1 }, // par 3: no fairway
      { ...emptyHoleEntry("a", 4), grossScore: 6, penaltyStrokes: 1, obStrokes: 2, sandAttempt: true, sandSave: false, upDownAttempt: true, upDown: true },
    ];
    const s = computeRoundStats("a", holes, entries);
    expect(s.holesEntered).toBe(4);
    expect(s.fairwayOpportunities).toBe(2);
    expect(s.fairwayPct).toBe(50);
    expect(s.girOpportunities).toBe(2);
    expect(s.girPct).toBe(100);
    expect(s.putts).toBe(3);
    expect(s.puttsPerGir).toBe(1.5);
    expect(s.penaltyStrokes).toBe(1);
    expect(s.obStrokes).toBe(2);
    expect(s.sandSavePct).toBe(0);
    expect(s.scramblingPct).toBe(100);
    expect(s.birdiesOrBetter).toBe(1);
    expect(s.pars).toBe(2);
    expect(s.doublesOrWorse).toBe(1);
    expect(s.par3Avg).toBe(2);
    expect(s.par4Avg).toBe(5);
    expect(s.par5Avg).toBe(5);
  });
  it("returns nulls with no data", () => {
    const s = computeRoundStats("a", holes, []);
    expect(s.fairwayPct).toBeNull();
    expect(s.putts).toBeNull();
    expect(s.par3Avg).toBeNull();
  });
});
