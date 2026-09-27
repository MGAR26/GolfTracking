import { describe, expect, it } from "vitest";
import { buildLeaderboard, classifyScore, computePlayerRoundTotals, formatToPar } from "@/domain/scoring";
import { allocateStrokes } from "@/domain/handicap";
import { emptyHoleEntry } from "@/domain/types";
import { course18, entriesFor, PAR_ROUND } from "./fixtures";

describe("computePlayerRoundTotals", () => {
  const holes = course18();
  it("computes out/in/total gross and net", () => {
    const alloc = allocateStrokes(7, holes);
    const entries = entriesFor({ matt: PAR_ROUND.map((p) => p + 1) }); // bogey golf = 90
    const t = computePlayerRoundTotals("matt", holes, alloc, entries);
    expect(t.total.gross).toBe(90);
    expect(t.total.net).toBe(83);
    expect(t.total.grossToPar).toBe(18);
    expect(t.total.netToPar).toBe(11);
    expect(t.out.holesPlayed).toBe(9);
    expect(t.in.holesPlayed).toBe(9);
    expect(t.out.gross + t.in.gross).toBe(90);
    expect(t.isComplete).toBe(true);
    expect(t.strokesReceived).toBe(7);
  });
  it("partial round only counts entered holes and stays incomplete", () => {
    const entries = [{ ...emptyHoleEntry("matt", 1), grossScore: 4 }, { ...emptyHoleEntry("matt", 2), grossScore: 6 }];
    const t = computePlayerRoundTotals("matt", holes, allocateStrokes(0, holes), entries);
    expect(t.holesPlayed).toBe(2);
    expect(t.total.gross).toBe(10);
    expect(t.total.grossToPar).toBe(1);
    expect(t.isComplete).toBe(false);
    expect(t.holes[2].gross).toBeNull();
  });
});

describe("buildLeaderboard", () => {
  const holes = course18();
  it("orders by net to par with shared positions for ties", () => {
    const entries = entriesFor({
      a: PAR_ROUND.map((p) => p + 1), // 90
      b: PAR_ROUND.map((p) => p), // 72
      c: PAR_ROUND.map((p) => p + 1), // 90
    });
    const mk = (id: string, hc: number) => ({ playerId: id, displayName: id, totals: computePlayerRoundTotals(id, holes, allocateStrokes(hc, holes), entries) });
    const rows = buildLeaderboard([mk("a", 18), mk("b", 0), mk("c", 18)], "NET");
    expect(rows.map((r) => r.position)).toEqual([1, 1, 1]);
    expect(rows.every((r) => r.tied)).toBe(true);
    const gross = buildLeaderboard([mk("a", 18), mk("b", 0), mk("c", 18)], "GROSS");
    expect(gross[0].playerId).toBe("b");
    expect(gross[1].position).toBe(2);
    expect(gross[2].position).toBe(2);
  });
});

describe("labels", () => {
  it("classifies and formats", () => {
    expect(classifyScore(-1)).toBe("BIRDIE");
    expect(classifyScore(-2)).toBe("EAGLE");
    expect(classifyScore(2)).toBe("DOUBLE");
    expect(formatToPar(0)).toBe("E");
    expect(formatToPar(3)).toBe("+3");
    expect(formatToPar(-2)).toBe("-2");
  });
});
