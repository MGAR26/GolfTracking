import { describe, expect, it } from "vitest";
import { clubForTarget, neutralFinish, solveAim } from "../../prototype/aiming";
import { dispersionModel } from "../../prototype/bag";
import { CALM, flightEnv } from "../../prototype/flight";
import { missFromAim, CLUBS, type Shot } from "../../prototype/shots";

const from = { u: 0, v: 0 }, target = { u: 160, v: 0 };
const north = 0;
const sevenIron = dispersionModel("7i", { "7i": { carry: 155, roll: 4, miss: "straight", width: "normal" } }, 5, [], "p");

describe("target → aim line", () => {
  it("calm, straight hitter: aim at the target", () => {
    const s = solveAim(sevenIron, CALM, from, target);
    expect(Math.abs(s.offset)).toBeLessThan(1);
    expect(Math.hypot(s.expected.u - 160, s.expected.v)).toBeLessThan(0.5);
  });
  it("a right-to-left wind means start it right, and a neutral swing there finishes on the target", () => {
    const env = flightEnv({ mph: 12, fromDeg: 90 }, north); // blowing west = right to left
    const s = solveAim(sevenIron, env, from, target);
    expect(s.offset).toBeGreaterThan(8);
    const f = neutralFinish(sevenIron, env, from, s.aimLine, true);
    expect(Math.hypot(f.u - target.u, f.v - target.v)).toBeLessThan(1);
  });
  it("a player who leaks right is told to start it left; the expected spot keeps the habit as their miss", () => {
    const leaky = { ...sevenIron, center: { lateral: 10, long: 0 } };
    const s = solveAim(leaky, CALM, from, target);
    expect(s.offset).toBeLessThan(-8);
    expect(s.expected.v).toBeLessThan(-8); // a neutral swing at that line would finish ~10 left of the target
  });
  it("misses are measured from where it should have finished, so the wind isn't counted", () => {
    const env = flightEnv({ mph: 12, fromDeg: 90 }, north);
    const s = solveAim(sevenIron, env, from, target);
    const shot: Shot = { id: "s", playerId: "p", holeNumber: 1, seq: 1, club: "7i", from, to: { ...target }, distance: 160, shape: null, trajectory: null, lie: "green", aim: target, aimLine: s.aimLine, expected: s.expected };
    const m = missFromAim(shot)!;
    expect(Math.abs(m.lateral)).toBeLessThan(1); // finished on the target: no miss, even though it started 10+ right
    const old: Shot = { ...shot, aimLine: null, expected: null, to: { u: 160, v: -12 } };
    expect(missFromAim(old)!.lateral).toBeCloseTo(-12); // older shots: measured from the target
  });
  it("the club follows the target and the conditions", () => {
    const models = CLUBS.map((club) => ({ club, model: dispersionModel(club, {}, 5, [], "p") }));
    expect(clubForTarget(models, CALM, from, { u: 20, v: 0 })).toBe("chip");
    const calm = clubForTarget(models, CALM, from, { u: 160, v: 0 });
    const into = clubForTarget(models, flightEnv({ mph: 20, fromDeg: 0 }, north), from, { u: 160, v: 0 });
    const order = CLUBS as readonly string[];
    expect(order.indexOf(into)).toBeLessThan(order.indexOf(calm)); // into the wind: a longer club
    expect(clubForTarget(models, CALM, from, { u: 250, v: 0 })).not.toBe(calm);
  });
});
