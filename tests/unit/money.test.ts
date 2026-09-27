import { describe, expect, it } from "vitest";
import { balancesSum, computeNetBalances, computePairwiseObligations, type LedgerEntry } from "@/domain/ledger";
import { optimizeSettlement } from "@/domain/settlement";
import { assertCanAccept, assertCanSettle, assertTermsEditable, autoResolve, isFullyAccepted, settlementsForSideBet, type SideBet } from "@/domain/side-bets";
import { entriesFor, PAR_ROUND } from "./fixtures";

const entry = (id: string, from: string, to: string, amountCents: number, status: LedgerEntry["status"] = "POSTED"): LedgerEntry => ({
  id, tripId: "t", roundId: "r", sourceType: "GAME", sourceId: "g", fromPlayerId: from, toPlayerId: to, amountCents, status, memo: "",
});

describe("ledger", () => {
  it("derives net balances that sum to zero and ignores reversed entries", () => {
    const entries = [entry("1", "matt", "marcus", 2000), entry("2", "ryan", "matt", 4500), entry("3", "matt", "ryan", 9999, "REVERSED")];
    const b = computeNetBalances(entries, ["matt", "marcus", "ryan", "john"]);
    expect(b).toEqual({ matt: 2500, marcus: 2000, ryan: -4500, john: 0 });
    expect(balancesSum(b)).toBe(0);
  });
  it("collapses pairwise obligations", () => {
    const o = computePairwiseObligations([entry("1", "a", "b", 100), entry("2", "a", "b", 50), entry("3", "b", "a", 25)]);
    expect(o).toEqual([
      { fromPlayerId: "a", toPlayerId: "b", amountCents: 150 },
      { fromPlayerId: "b", toPlayerId: "a", amountCents: 25 },
    ]);
  });
});

describe("settlement optimizer", () => {
  it("spec example: Matt -25, Marcus +50, Ryan -25 -> two payments, zero residual", () => {
    const plan = optimizeSettlement({ matt: -2500, marcus: 5000, ryan: -2500 });
    expect(plan.residualCents).toBe(0);
    expect(plan.payments).toEqual([
      { fromPlayerId: "matt", toPlayerId: "marcus", amountCents: 2500 },
      { fromPlayerId: "ryan", toPlayerId: "marcus", amountCents: 2500 },
    ]);
  });
  it("handles many players with fewer payments than obligations", () => {
    const plan = optimizeSettlement({ a: -700, b: 300, c: 400, d: -100, e: 100 });
    expect(plan.residualCents).toBe(0);
    expect(plan.payments.length).toBeLessThanOrEqual(4);
    const check: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    for (const p of plan.payments) {
      check[p.fromPlayerId] -= p.amountCents;
      check[p.toPlayerId] += p.amountCents;
    }
    expect(check).toEqual({ a: -700, b: 300, c: 400, d: -100, e: 100 });
  });
  it("empty balances produce no payments", () => {
    expect(optimizeSettlement({ a: 0 })).toEqual({ payments: [], residualCents: 0 });
  });
});

describe("side bets", () => {
  const bet = (): SideBet => ({
    id: "sb1",
    roundId: "r",
    creatorId: "matt",
    terms: { type: "LONGEST_DRIVE_IN_FAIRWAY", description: "Longest drive - Hole 8", amountCents: 2000, holeNumbers: [8], basis: "GROSS" },
    participants: [
      { playerId: "matt", side: "A", acceptedAt: "now" },
      { playerId: "marcus", side: "B", acceptedAt: null },
    ],
    status: "PROPOSED",
  });
  it("cannot settle before acceptance", () => {
    const b = bet();
    expect(isFullyAccepted(b)).toBe(false);
    expect(() => assertCanSettle(b)).toThrow(/accepted/);
  });
  it("accept flow locks terms", () => {
    const b = bet();
    assertCanAccept(b, "marcus");
    b.participants[1].acceptedAt = "now";
    expect(isFullyAccepted(b)).toBe(true);
    b.status = "ACCEPTED";
    expect(() => assertTermsEditable(b)).toThrow(/locked/);
    expect(() => assertCanAccept(b, "marcus")).toThrow();
    expect(() => assertCanAccept(b, "ryan")).toThrow();
  });
  it("produces one ledger obligation per losing/winning pair", () => {
    const b = bet();
    expect(settlementsForSideBet(b, "B", "Longest Drive - Hole 8")).toEqual([
      { fromPlayerId: "matt", toPlayerId: "marcus", amountCents: 2000, memo: "Longest Drive - Hole 8" },
    ]);
  });
  it("auto-resolves deterministic bets only", () => {
    const manual = bet();
    const entries = entriesFor({ matt: PAR_ROUND, marcus: PAR_ROUND.map((p, i) => (i === 7 ? p + 1 : p)) });
    expect(autoResolve(manual, entries, () => ({}))).toBeNull();
    const auto = { ...bet(), terms: { ...bet().terms, type: "HOLE_WINNER" as const } };
    expect(autoResolve(auto, entries, () => ({}))).toBe("A");
    const autoNet = { ...auto, terms: { ...auto.terms, basis: "NET" as const } };
    expect(autoResolve(autoNet, entries, (pid): Record<number, number> => (pid === "marcus" ? { 8: 1 } : {}))).toBe("TIE");
    expect(autoResolve(auto, entries.filter((e) => e.holeNumber !== 8), () => ({}))).toBeNull();
  });
});
