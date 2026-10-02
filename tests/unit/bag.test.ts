import { describe, expect, it } from "vitest";
import { defaultProfile, dispersionModel, dispersionOutline, ellipseScale, expectedLanding, sampleShot } from "../../prototype/bag";
import type { Shot } from "../../prototype/shots";

const aimed = (n: number, lateral: number, long: number): Shot[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, playerId: "p", holeNumber: 1, seq: 1, club: "7i", from: { u: 0, v: 0 }, to: { u: 150 + long, v: lateral }, distance: Math.hypot(150 + long, lateral), shape: null, trajectory: null, lie: null, aim: { u: 150, v: 0 } }));

describe("my bag dispersion", () => {
  it("falls back to a handicap-scaled profile with no shots", () => {
    const m = dispersionModel("7i", {}, 20, [], "p");
    expect(m.source).toBe("profile");
    expect(m.carry).toBeLessThan(155);
    expect(m.sdLateral).toBeGreaterThan(dispersionModel("7i", {}, 5, [], "p").sdLateral);
  });
  it("a right miss shifts the centre right, two-way widens it", () => {
    const right = dispersionModel("Dr", { Dr: { carry: 260, miss: "right", width: "normal" } }, 10, [], "p");
    const two = dispersionModel("Dr", { Dr: { carry: 260, miss: "two-way", width: "normal" } }, 10, [], "p");
    expect(right.center.lateral).toBeGreaterThan(3);
    expect(two.center.lateral).toBe(0);
    expect(two.sdLateral).toBeGreaterThan(right.sdLateral);
  });
  it("blends toward the player's aimed shots as they accumulate", () => {
    const profile = { "7i": { carry: 150, miss: "straight" as const, width: "normal" as const } };
    const few = dispersionModel("7i", profile, 10, aimed(3, 10, -5), "p");
    const many = dispersionModel("7i", profile, 10, aimed(20, 10, -5), "p");
    expect(few.center.lateral).toBeGreaterThan(0);
    expect(many.center.lateral).toBeGreaterThan(few.center.lateral);
    expect(many.confidence).toBe("high");
    expect(Math.abs(many.carry - Math.hypot(145, 10))).toBeLessThan(2.5);
  });
  it("ellipse and expected landing sit on the aim line, rotated with the shot", () => {
    const m = dispersionModel("7i", { "7i": { carry: 150, miss: "straight", width: "normal" } }, 10, [], "p");
    const from = { u: 100, v: 0 }, target = { u: 100, v: 200 }; // shot straight "right" in hole coords
    const e = expectedLanding(m, from, target);
    expect(e.u).toBeCloseTo(100, 0);
    expect(e.v).toBeCloseTo(150, 0);
    const outline = dispersionOutline(m, from, target, 0.8);
    expect(outline).toHaveLength(40);
    const maxLat = Math.max(...outline.map((p) => Math.abs(p.u - 100)));
    expect(maxLat).toBeCloseTo(m.sdLateral * ellipseScale(0.8), 0);
    const s = sampleShot(m, from, target, 3);
    expect(Math.hypot(s.u - from.u, s.v - from.v)).toBeGreaterThan(100);
  });
  it("default profile is sensible per handicap", () => {
    expect(defaultProfile("Dr", 2).width).toBe("narrow");
    expect(defaultProfile("Dr", 25).width).toBe("wide");
  });
});
