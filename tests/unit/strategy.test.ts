import { describe, expect, it } from "vitest";
import { expectedStrokes } from "../../src/domain/strategy/expectedStrokes";
import { buildHole } from "../../prototype/holeGeometry";
import { dispersionModel } from "../../prototype/bag";
import { recommend, simulate, aimFor, utility } from "../../prototype/strategy";

describe("expected strokes", () => {
  it("grows with distance and is worse from rough, sand and water", () => {
    expect(expectedStrokes({ distanceYards: 150, lie: "fairway" })).toBeGreaterThan(expectedStrokes({ distanceYards: 100, lie: "fairway" }));
    expect(expectedStrokes({ distanceYards: 150, lie: "rough" })).toBeGreaterThan(expectedStrokes({ distanceYards: 150, lie: "fairway" }));
    expect(expectedStrokes({ distanceYards: 150, lie: "sand" })).toBeGreaterThan(expectedStrokes({ distanceYards: 150, lie: "rough" }));
    expect(expectedStrokes({ distanceYards: 150, lie: "water" })).toBeGreaterThan(expectedStrokes({ distanceYards: 150, lie: "sand" }) + 0.4);
  });
  it("a 15 handicap needs more strokes than scratch from the same spot, and putting is in feet", () => {
    expect(expectedStrokes({ distanceYards: 400, lie: "tee", handicapIndex: 15 })).toBeGreaterThan(expectedStrokes({ distanceYards: 400, lie: "tee" }) + 0.4);
    expect(expectedStrokes({ distanceYards: 1, lie: "green" })).toBeLessThan(1.1);
    expect(expectedStrokes({ distanceYards: 10, lie: "green" })).toBeGreaterThan(1.8);
  });
});

describe("strategy", () => {
  const hole = buildHole(4, 4, 420);
  const models = (club: Parameters<typeof dispersionModel>[0]) => dispersionModel(club, {}, 10, [], "p");
  it("odds add to one and a safe play never carries more penalty risk than attack", () => {
    const s = recommend(models, { u: 0, v: 0 }, hole.green.c, hole, 10, 0, 200);
    const sum = Object.values(s.plays[1].sim.odds).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    const safe = s.plays.find((p) => p.kind === "safe")!.sim, attack = s.plays.find((p) => p.kind === "attack")!.sim;
    expect(safe.penaltyProb).toBeLessThanOrEqual(attack.penaltyProb + 1e-9);
    expect(utility(safe, -1)).toBeLessThanOrEqual(utility(attack, -1));
    expect(s.recommended.expected).toBeGreaterThan(2);
    expect(s.recommended.expected).toBeLessThan(6);
  });
  it("aim offsets go right of the line and a shot from 20 yards is mostly on the green", () => {
    const a = aimFor({ u: 0, v: 0 }, { u: 400, v: 0 }, 250, 15);
    expect(a.u).toBeCloseTo(250, 5);
    expect(a.v).toBeCloseTo(15, 5);
    const close = simulate({ ...models("LW"), carry: 20, sdLateral: 3, sdLong: 3, center: { lateral: 0, long: 0 } }, { u: hole.green.c.u - 20, v: hole.green.c.v }, hole.green.c, hole.green.c, hole, 10, 300);
    expect(close.odds.green).toBeGreaterThan(0.6);
  });
});

describe("plays-like factors", () => {
  it("lists each factor with its yards and says how confident it is", async () => {
    const { playsLike, holeConditions, DEFAULT_CONDITIONS } = await import("../../prototype/holeGeometry");
    const cond = { ...holeConditions(4, 4), elevationFt: 0, bearingDeg: 0 };
    const base = playsLike({ u: 0, v: 0 }, { u: 150, v: 0 }, 400, cond, { mph: 0, fromDeg: 0 });
    expect(base.confidence).toBe("low");
    expect(base.playsLike).toBeCloseTo(150, 5);
    const hot = playsLike({ u: 0, v: 0 }, { u: 150, v: 0 }, 400, cond, { mph: 0, fromDeg: 0 }, { ...DEFAULT_CONDITIONS, tempF: 95, altitudeFt: 5000, firmness: "firm" });
    expect(hot.playsLike).toBeLessThan(base.playsLike - 15);
    expect(hot.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["temperature", "altitude", "firmness"]));
    expect(hot.factors.reduce((a, f) => a + f.yards, 0)).toBeCloseTo(hot.playsLike - 150, 5);
    const sure = playsLike({ u: 0, v: 0 }, { u: 150, v: 0 }, 400, cond, { mph: 0, fromDeg: 0 }, { ...DEFAULT_CONDITIONS, elevationSource: "measured", windSource: "forecast" });
    expect(sure.confidence).toBe("high");
  });
});
