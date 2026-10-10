import { describe, expect, it } from "vitest";
import { normalizeVenmo, roundSettlement, roundSnapshot, seedState, setVenmo, liveMoney } from "../../prototype/store";
import { venmoPayUrl, venmoRequestUrl } from "../../prototype/SettleUp";

describe("Venmo usernames", () => {
  it("accepts what people paste and rejects junk", () => {
    expect(normalizeVenmo("@Marcus-Lee")).toBe("Marcus-Lee");
    expect(normalizeVenmo("  https://venmo.com/u/Marcus_Lee7 ")).toBe("Marcus_Lee7");
    expect(normalizeVenmo("account.venmo.com/u/Marcus-Lee?txn=pay")).toBe("Marcus-Lee");
    expect(() => normalizeVenmo("abc")).toThrow();
    expect(() => normalizeVenmo("has spaces in it")).toThrow();
  });
  it("only the player can set their own", () => {
    const s = seedState();
    setVenmo(s, s.actorId, "@Matt-New-Handle");
    expect(s.players.find((p) => p.id === s.actorId)!.venmo).toBe("Matt-New-Handle");
    expect(() => setVenmo(s, "p_john", "John-Handle")).toThrow();
    setVenmo(s, s.actorId, null);
    expect(s.players.find((p) => p.id === s.actorId)!.venmo).toBeUndefined();
  });
});

describe("settle-up links", () => {
  it("pre-fills recipient, amount and note", () => {
    expect(venmoPayUrl("GTO-Demo-Marcus", 5000, "Pinehurst No. 4 · Round 1")).toBe("https://venmo.com/?txn=pay&recipients=GTO-Demo-Marcus&amount=50.00&note=Pinehurst%20No.%204%20%C2%B7%20Round%201");
    expect(venmoRequestUrl("GTO-Demo-Matt", 1250, "x")).toContain("txn=charge&recipients=GTO-Demo-Matt&amount=12.50");
  });
  it("round settlement clears every player's round money", () => {
    const s = seedState();
    const live = s.rounds.find((r) => r.status === "LIVE")!;
    const snap = roundSnapshot(s, live.id);
    const plan = roundSettlement(snap);
    expect(plan.payments.length).toBeGreaterThan(0);
    for (const p of snap.players) {
      const paid = plan.payments.filter((x) => x.fromPlayerId === p.playerId).reduce((a, x) => a + x.amountCents, 0);
      const got = plan.payments.filter((x) => x.toPlayerId === p.playerId).reduce((a, x) => a + x.amountCents, 0);
      expect(got - paid).toBe(liveMoney(snap, p.playerId));
    }
  });
});
