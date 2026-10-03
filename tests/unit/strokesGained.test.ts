import { describe, expect, it } from "vitest";
import { expectedStrokes } from "../../src/domain/strategy/expectedStrokes";
import { strokesGainedForHole, strokesGainedForShot, sgCategory } from "../../src/domain/strategy/strokesGained";
import { holeStrokesGained, roundStrokesGained, sgInputs } from "../../prototype/strokesGained";
import type { Shot } from "../../prototype/shots";

const flag = { u: 400, v: 0 };
const shot = (seq: number, from: { u: number; v: number }, to: { u: number; v: number }, club: Shot["club"], lie: Shot["lie"], extra: Partial<Shot> = {}): Shot =>
  ({ id: `s${seq}`, playerId: "p", holeNumber: 1, seq, club, from, to, distance: Math.hypot(to.u - from.u, to.v - from.v), shape: null, trajectory: null, lie, ...extra });

describe("strokes gained", () => {
  it("categorises by Broadie's split", () => {
    const base = { endDistanceYards: 0, endLie: "green" as const, holed: false };
    expect(sgCategory({ ...base, startDistanceYards: 400, startLie: "tee" }, true, 4)).toBe("tee");
    expect(sgCategory({ ...base, startDistanceYards: 170, startLie: "tee" }, true, 3)).toBe("approach");
    expect(sgCategory({ ...base, startDistanceYards: 150, startLie: "fairway" }, false, 4)).toBe("approach");
    expect(sgCategory({ ...base, startDistanceYards: 40, startLie: "rough" }, false, 4)).toBe("around");
    expect(sgCategory({ ...base, startDistanceYards: 8, startLie: "green" }, false, 4)).toBe("putting");
  });
  it("a shot is before minus after minus one; a holed putt gains the whole leftover", () => {
    const s = strokesGainedForShot({ startDistanceYards: 150, startLie: "fairway", endDistanceYards: 5, endLie: "green", holed: false }, false, 4, 0);
    expect(s.gained).toBeCloseTo(expectedStrokes({ distanceYards: 150, lie: "fairway" }) - expectedStrokes({ distanceYards: 5, lie: "green" }) - 1);
    const holed = strokesGainedForShot({ startDistanceYards: 5, startLie: "green", endDistanceYards: 0, endLie: "green", holed: true }, false, 4, 0);
    expect(holed.gained).toBeCloseTo(expectedStrokes({ distanceYards: 5, lie: "green" }) - 1);
  });
  it("sums to expected-from-the-tee minus strokes taken once holed, on either baseline", () => {
    const shots = [
      shot(1, { u: 0, v: 0 }, { u: 250, v: 10 }, "Dr", "fairway"),
      shot(2, { u: 250, v: 10 }, { u: 395, v: 3 }, "8i", "green"),
      shot(3, { u: 395, v: 3 }, { u: 400.5, v: 0 }, "putt", "green"),
      shot(4, { u: 400.5, v: 0 }, { u: 400, v: 0 }, "putt", "green", { holed: true }),
    ];
    for (const baseline of ["handicap", "scratch"] as const) {
      const r = holeStrokesGained(shots, flag, 4, 12, baseline);
      const hcp = baseline === "scratch" ? 0 : 12;
      expect(r.totals.total).toBeCloseTo(expectedStrokes({ distanceYards: 400, lie: "tee", handicapIndex: hcp }) - 4, 6);
      expect(r.totals.shots).toBe(4);
      expect(r.byId.s1.category).toBe("tee"); expect(r.byId.s2.category).toBe("approach"); expect(r.byId.s3.category).toBe("putting");
    }
    // a 12 handicap who makes 4 on a 400-yard hole gained against their own curve, lost against scratch
    expect(holeStrokesGained(shots, flag, 4, 12, "handicap").totals.total).toBeGreaterThan(holeStrokesGained(shots, flag, 4, 12, "scratch").totals.total);
  });
  it("starting lies follow the previous shot, putts start on the green, fringe reads as fairway", () => {
    const shots = [shot(1, { u: 0, v: 0 }, { u: 240, v: 0 }, "Dr", "rough"), shot(2, { u: 240, v: 0 }, { u: 390, v: 0 }, "7i", "fringe"), shot(3, { u: 390, v: 0 }, { u: 399, v: 0 }, "chip", "green"), shot(4, { u: 399, v: 0 }, { u: 400, v: 0 }, "putt", "green", { holed: true })];
    const inputs = sgInputs(shots, flag);
    expect(inputs.map((i) => i.startLie)).toEqual(["tee", "rough", "fairway", "green"]);
    expect(inputs[3].holed).toBe(true); expect(inputs[3].endDistanceYards).toBe(0);
  });
  it("plan vs actual is what the play promised minus what the shot left, on the player's own handicap whatever is displayed", () => {
    const promised = expectedStrokes({ distanceYards: 150, lie: "fairway", handicapIndex: 12 });
    const s = strokesGainedForShot({ startDistanceYards: 150, startLie: "fairway", endDistanceYards: 10, endLie: "green", holed: false, plannedExpected: promised }, false, 4, 0, 12);
    expect(s.planDelta).toBeCloseTo(promised - (1 + expectedStrokes({ distanceYards: 10, lie: "green", handicapIndex: 12 })));
    const r = strokesGainedForHole([{ startDistanceYards: 150, startLie: "fairway", endDistanceYards: 10, endLie: "green", holed: false, plannedExpected: promised }], 4, 12);
    expect(r.totals.planned.shots).toBe(1);
    expect(r.totals.planned.delta).toBeCloseTo(s.planDelta!);
  });
  it("round totals merge holes and skip untracked ones", () => {
    const h = [shot(1, { u: 0, v: 0 }, { u: 150, v: 0 }, "7i", "green", { holeNumber: 3 }), shot(2, { u: 150, v: 0 }, { u: 150, v: 0 }, "putt", "green", { holeNumber: 3, holed: true })];
    const t = roundStrokesGained([{ shots: [], flag, par: 4 }, { shots: h, flag: { u: 150, v: 0 }, par: 3 }], 5, "handicap");
    expect(t.shots).toBe(2);
    expect(t.byCategory.approach + t.byCategory.putting).toBeCloseTo(t.total);
    expect(t.byCategory.tee).toBe(0);
  });
});
