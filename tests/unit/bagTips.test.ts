import { describe, expect, it } from "vitest";
import { bagTip, dispersionModel, TIP_AFTER_SHOTS } from "../../prototype/bag";
import { applyBagTip, bagTips, dismissBagTip, playerShots, seedState } from "../../prototype/store";
import type { Shot } from "../../prototype/shots";

const from = { u: 0, v: 0 };
const drives = (n: number, lateral: number, long: number): Shot[] => Array.from({ length: n }, (_, i) => ({
  id: `d${i}`, playerId: "p", holeNumber: 1, seq: 1, club: "Dr", from, aim: { u: 270, v: 0 },
  to: { u: 270 + long + ((i % 3) - 1) * 4, v: lateral + ((i % 2) * 2 - 1) * 5 }, distance: 270 + long, shape: null, trajectory: null, lie: "fairway",
}));
const bag = { Dr: { carry: 250, roll: 20, miss: "straight" as const, width: "normal" as const } };

describe("bag tips", () => {
  it("waits for enough aimed shots", () => {
    expect(bagTip("Dr", bag, 5, drives(TIP_AFTER_SHOTS - 1, 16, -7), "p")).toBeNull();
  });
  it("calls out a steady right leak and coming up short, and the fix updates the bag", () => {
    const t = bagTip("Dr", bag, 5, drives(10, 16, -7), "p")!;
    expect(t.lateral).toBe(16);
    expect(t.measuredCarry).toBe(Math.round(Math.hypot(263, 16) - 20 + 0.0)); // finish ~263.5 minus 20 roll
    expect(t.long).toBe((t.measuredCarry ?? 0) - 250);
    expect(t.patch).toMatchObject({ miss: "right", lateralBias: 16, carry: t.measuredCarry, roll: 20 });
    const after = { Dr: t.patch as typeof bag.Dr };
    expect(dispersionModel("Dr", after, 5, [], "p").center.lateral).toBe(16); // the plays now aim to bring it back
    expect(bagTip("Dr", after, 5, drives(10, 16, -7), "p")).toBeNull(); // accepted: nothing left to suggest
  });
  it("stays quiet for a straight, on-distance club", () => {
    expect(bagTip("Dr", bag, 5, drives(12, 1, 2), "p")).toBeNull();
  });
  it("in the demo, Matt's driver history produces a tip that applies and can be put off", () => {
    const s = seedState();
    expect(playerShots(s, "p_matt").some((x) => x.id.startsWith("past_"))).toBe(true);
    const tip = bagTips(s, "p_matt").find((t) => t.club === "Dr")!;
    expect(tip.lateral).toBeGreaterThan(8);
    dismissBagTip(s, "p_matt", tip);
    expect(bagTips(s, "p_matt").some((t) => t.club === "Dr")).toBe(false);
    s.dismissedBagTips = {};
    applyBagTip(s, "p_matt", tip);
    expect(s.players.find((p) => p.id === "p_matt")!.bag!.Dr!.miss).toBe("right");
    expect(bagTips(s, "p_matt").find((t) => t.club === "Dr")).toBeUndefined();
  });
});
