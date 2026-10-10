import { describe, expect, it } from "vitest";
import { caddieAdvice, historyLine } from "../../prototype/caddie";
import type { Simulation, Strategy } from "../../prototype/strategy";
import type { HazardDistance } from "../../prototype/holeGeometry";
import type { Club } from "../../prototype/shots";

const from = { u: 0, v: 0 };
const sim = (club: Club, carry: number, off: number, expected: number, odds: Partial<Simulation["odds"]> = {}, leave = 140): Simulation => ({
  club, aim: { u: carry, v: off }, aimOffset: off, samples: 500, expected, p10: expected - 0.5, p90: expected + 0.6, penaltyProb: odds.water ?? 0, leave,
  odds: { fairway: 0.6, rough: 0.3, sand: 0, water: 0, green: 0, ...odds }, finish: { u: carry, v: off },
});
const plan = (rec: Simulation, attack: Simulation, safe: Simulation): Strategy => ({ candidates: [rec, attack, safe], plays: [{ kind: "safe", sim: safe }, { kind: "balanced", sim: rec }, { kind: "attack", sim: attack }], recommended: rec, risk: 0 });
const bunkerR: HazardDistance = { kind: "bunker", side: "R", to: 225, carry: 252, at: { u: 225, v: 20 }, farAt: { u: 252, v: 25 } };

describe("caddie wording", () => {
  it("names the play, the hazard in its landing zone with its odds, and what the bold play buys", () => {
    const rec = sim("Hy", 205, -10, 4.05, { sand: 0.04 }, 165);
    const attack = sim("Dr", 245, 0, 3.98, { sand: 0.22 }, 125);
    const safe = sim("5i", 180, -10, 4.12, {}, 190);
    const a = caddieAdvice({ plan: plan(rec, attack, safe), current: null, hazards: [bunkerR], from, remaining: 370 });
    expect(a.headline).toBe("Hybrid 10 yards left, leaves about 165.");
    expect(a.lines[0]).toBe("Watch the bunker right at 225–252: this play finds it 4% of the time.");
    expect(a.lines[1]).toBe("Driver at the middle gains 0.1 strokes but brings sand 22% in.");
  });
  it("says the green odds when the play reaches, and flags a different pick by the player", () => {
    const rec = sim("7i", 150, 0, 2.9, { green: 0.52, fairway: 0.2 }, 12);
    const same = { ...rec };
    const current = sim("8i", 140, 0, 3.1, { green: 0.31, water: 0.09 }, 18);
    const a = caddieAdvice({ plan: plan(rec, same, same), current, hazards: [], from, remaining: 152 });
    expect(a.headline).toBe("7-iron at the middle: on the green 52% of the time.");
    expect(a.lines).toContain("Your 8-iron costs 0.2 strokes against that; water 9%.");
  });
  it("calls out a hazard the play stays short of, and the cost of the bold line", () => {
    const rec = sim("5i", 180, 0, 4.1, {}, 200);
    const attack = sim("Dr", 250, 0, 4.3, { water: 0.18 }, 130);
    const water: HazardDistance = { kind: "water", side: "L", to: 230, carry: 270, at: { u: 230, v: -15 }, farAt: { u: 270, v: -20 } };
    const a = caddieAdvice({ plan: plan(rec, attack, rec), current: null, hazards: [water], from, remaining: 380 });
    expect(a.lines[0]).toBe("Stays short of the water left at 230.");
    expect(a.lines[1]).toBe("Driver at the middle costs 0.2 strokes (water 18%).");
  });
  it("treats a long lateral hazard as a side, skips one the play never finds, and does not repeat the bold play", () => {
    const rec = sim("Dr", 240, -30, 4.0, { water: 0.05, rough: 0.5 }, 160);
    const attack = sim("Dr", 240, 0, 4.2, { water: 0.12, rough: 0.82 }, 150);
    const lateral: HazardDistance = { kind: "water", side: "R", to: 58, carry: 413, at: { u: 58, v: 40 }, farAt: { u: 413, v: 30 } };
    const a = caddieAdvice({ plan: plan(rec, attack, rec), current: attack, hazards: [lateral], from, remaining: 400 });
    expect(a.lines[0]).toBe("Water runs down the right from 58: this play finds it 5% of the time.");
    expect(a.lines[1]).toBe("Aiming at the middle costs 0.2 strokes (water 12%).");
    expect(a.lines).toHaveLength(2);
    const dry = caddieAdvice({ plan: plan({ ...rec, odds: { ...rec.odds, water: 0 } }, attack, rec), current: null, hazards: [lateral], from, remaining: 400 });
    expect(dry.lines[0]).toBe("Keeps the water right out of play.");
  });
  it("adds what happened here before on the tee, after the hazard line", () => {
    const rec = sim("Hy", 205, -10, 4.05, { sand: 0.04 }, 165);
    const attack = sim("Dr", 245, 0, 3.98, { sand: 0.22 }, 125);
    const history = [{ club: "Dr" as const, kind: "attack" as const, gross: 5, par: 4 }, { club: "Hy" as const, kind: "safe" as const, gross: 4, par: 4 }];
    const a = caddieAdvice({ plan: plan(rec, attack, rec), current: null, hazards: [bunkerR], from, remaining: 370, history });
    expect(a.lines[0]).toMatch(/^Watch the bunker right/);
    expect(a.lines[1]).toBe("Here before: driver (attack) made 5 (bogey), hybrid (safe) made 4 (par).");
    expect(historyLine([{ club: "Dr", kind: "attack", gross: 4, par: 4 }, { club: "Dr", kind: "balanced", gross: 5, par: 4 }])).toBe("Your last 2 here off the tee were all driver: made 4, 5.");
    expect(historyLine([])).toBeNull();
  });
});
