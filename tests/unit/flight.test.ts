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

describe("roll-out", () => {
  it("runs on after landing, less in rough, and can run into a bunker", async () => {
    const { finishShot } = await import("../../prototype/flight");
    const { buildHole, lieAt } = await import("../../prototype/holeGeometry");
    const hole = buildHole(1, 4, 400);
    const from = { u: 0, v: 0 };
    // land on the fairway centre line, roll 20
    const fw = hole.line[Math.floor(hole.line.length / 2)];
    const r = finishShot(CALM, hole, from, fw, fw, 20);
    expect(lieAt(hole, r.land)).toBe(r.landLie);
    if (r.landLie === "fairway") expect(Math.hypot(r.rest.u - r.land.u, r.rest.v - r.land.v)).toBeGreaterThan(9);
    // firm turf rolls farther than soft
    const firm = finishShot({ ...CALM, rollFactor: 1.5 }, hole, from, fw, fw, 20), soft = finishShot({ ...CALM, rollFactor: 0.5 }, hole, from, fw, fw, 20);
    expect(Math.hypot(firm.rest.u - firm.land.u, firm.rest.v - firm.land.v)).toBeGreaterThan(Math.hypot(soft.rest.u - soft.land.u, soft.rest.v - soft.land.v));
    // a ball landing just short of a bunker on its line runs into it
    const b = hole.bunkers[0];
    const dir = { u: b.c.u / Math.hypot(b.c.u, b.c.v), v: b.c.v / Math.hypot(b.c.u, b.c.v) };
    const short = { u: b.c.u - dir.u * (b.ru + 6), v: b.c.v - dir.v * (b.ru + 6) };
    if (lieAt(hole, short) !== "sand" && lieAt(hole, short) !== "water") {
      const into = finishShot(CALM, hole, from, short, short, 2 * (b.ru + 6));
      expect(into.lie).toBe("sand");
    }
    // sand stops it dead
    const inSand = finishShot(CALM, hole, from, b.c, b.c, 20);
    expect(inSand.rest).toEqual(inSand.land);
  });
});
