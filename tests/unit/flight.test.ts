import { describe, expect, it } from "vitest";
import { applyFlight, flightEnv, windFor, CALM } from "../../prototype/flight";
import { buildHole, playsLike } from "../../prototype/holeGeometry";
import { dispersionModel } from "../../prototype/bag";
import { recommend } from "../../prototype/strategy";
import { windLine } from "../../prototype/caddie";

const north = 0; // hole plays due north: + v is east
describe("flight model", () => {
  it("turns a compass wind into the hole frame", () => {
    const west = flightEnv({ mph: 10, fromDeg: 270 }, north); // blowing east = to the right
    expect(west.windV).toBeCloseTo(10); expect(west.windU).toBeCloseTo(0);
    const south = flightEnv({ mph: 10, fromDeg: 180 }, north); // blowing north = helping
    expect(windFor(south, { u: 0, v: 0 }, { u: 150, v: 0 }).head).toBeCloseTo(-10);
    expect(windFor(west, { u: 0, v: 0 }, { u: 150, v: 0 }).cross).toBeCloseTo(10);
  });
  it("drifts, shortens into the wind, and takes yards off for landing uphill", () => {
    const from = { u: 0, v: 0 }, aim = { u: 200, v: 0 };
    expect(applyFlight(CALM, from, aim, aim)).toEqual(aim);
    const cross = applyFlight(flightEnv({ mph: 10, fromDeg: 270 }, north), from, aim, aim);
    expect(cross.v).toBeCloseTo(11); // 0.55 yd per mph per 100 yd
    const into = applyFlight(flightEnv({ mph: 10, fromDeg: 0 }, north), from, aim, aim);
    expect(into.u).toBeCloseTo(180);
    const up = applyFlight({ windU: 0, windV: 0, elevation: [{ u: 0, ft: 100 }, { u: 300, ft: 130 }] }, from, aim, aim);
    expect(up.u).toBeCloseTo(200 - 20 / 3, 0);
  });
  it("labels the crosswind the way the ball moves", () => {
    const cond = { bearingDeg: north, elevationFt: 0, tilt: { u: -1, v: 0, pct: 1 } };
    expect(playsLike({ u: 0, v: 0 }, { u: 200, v: 0 }, 200, cond, { mph: 12, fromDeg: 270 }).crosswindMph).toBeCloseTo(12); // L→R
    expect(playsLike({ u: 0, v: 0 }, { u: 200, v: 0 }, 200, cond, { mph: 12, fromDeg: 90 }).crosswindMph).toBeCloseTo(-12); // R→L
  });
  it("the recommended aim leans into a crosswind, and the caddie says why", () => {
    const hole = buildHole(6, 3, 190);
    const models = (c: Parameters<typeof dispersionModel>[0]) => dispersionModel(c, {}, 5, [], "p");
    const from = { u: 0, v: 0 }, flag = hole.green.c;
    const calm = recommend(models, from, flag, hole, 5, 0, 300).recommended;
    const env = flightEnv({ mph: 15, fromDeg: 90 }, north); // blowing west: right to left
    const windy = recommend(models, from, flag, hole, 5, 0, 300, env).recommended;
    expect(windy.aimOffset).toBeGreaterThan(calm.aimOffset + 8); // aim right, let it come back
    expect(windLine(env, from, windy)).toMatch(/^15 mph right to left moves it about \d+ yards, so the aim is \d+ right and the wind brings it back\.$/);
  });
});
