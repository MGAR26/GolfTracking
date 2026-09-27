import { describe, expect, it } from "vitest";
import { bestBallGame, matchPlayGame, nassauGame, runGame, skinsGame, stablefordGame, strokePlayGame } from "@/domain/games";
import { computeNetBalances, balancesSum } from "@/domain/ledger";
import { course18, ctx, entriesFor, PAR_ROUND, player } from "./fixtures";
import { allocateStrokes } from "@/domain/handicap";

const par = () => [...PAR_ROUND];
const withHole = (arr: number[], hole: number, score: number) => arr.map((s, i) => (i === hole - 1 ? score : s));

function ledgerNetsToZero(settlements: { fromPlayerId: string; toPlayerId: string; amountCents: number }[]) {
  const entries = settlements.map((s, i) => ({ id: String(i), tripId: null, roundId: null, sourceType: "GAME" as const, sourceId: "g", status: "POSTED" as const, memo: "", ...s }));
  expect(balancesSum(computeNetBalances(entries))).toBe(0);
}

describe("stroke play", () => {
  it("tracks gross/net and pays low net", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 5)]);
    const entries = entriesFor({ a: par(), b: par().map((p) => p + 1) }); // b: 90 gross, 85 net
    const r = runGame(strokePlayGame, c, { basis: "NET", stakeCents: 1000 }, entries);
    expect(r.state.totals.a).toEqual({ gross: 72, net: 72 });
    expect(r.state.totals.b).toEqual({ gross: 90, net: 85 });
    expect(r.settlements).toEqual([{ fromPlayerId: "b", toPlayerId: "a", amountCents: 1000, memo: "Low net stroke play" }]);
  });
  it("ties split the stake in integer cents", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0), player("c", "C", 0)]);
    const entries = entriesFor({ a: par(), b: par(), c: par().map((p) => p + 1) });
    const r = runGame(strokePlayGame, c, { basis: "GROSS", stakeCents: 1001 }, entries);
    expect(r.settlements.map((s) => s.amountCents)).toEqual([501, 500]);
    ledgerNetsToZero(r.settlements);
  });
  it("stops at the first incomplete hole", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0)]);
    const entries = entriesFor({ a: par().slice(0, 5), b: par().slice(0, 3) });
    const r = runGame(strokePlayGame, c, {}, entries);
    expect(r.holesFinalized).toEqual([1, 2, 3]);
    expect(r.settlements).toEqual([]);
  });
});

describe("skins", () => {
  it("awards skins with ties carrying over", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0), player("c", "C", 0)]);
    let a = par(), b = par();
    const cc = par();
    a = withHole(a, 3, 2); // a wins hole 3 outright
    // holes 4,5 tie (all par), hole 6: b birdies -> 3 skins
    b = withHole(b, 6, 2);
    const r = runGame(skinsGame, c, { basis: "GROSS", skinValueCents: 500, carryover: true }, entriesFor({ a, b, c: cc }));
    expect(r.state.results[0].winnerPlayerId).toBeNull(); // hole 1 tie
    expect(r.state.results[2]).toMatchObject({ winnerPlayerId: "a", skins: 3 }); // holes 1,2 carried + 3
    expect(r.state.results[5]).toMatchObject({ winnerPlayerId: "b", skins: 3 });
    expect(r.state.skinsByPlayer).toEqual({ a: 3, b: 3, c: 0 });
    // each skin worth $5 from each other player
    const aWins = r.settlements.filter((s) => s.toPlayerId === "a");
    expect(aWins).toHaveLength(2);
    expect(aWins[0].amountCents).toBe(1500);
    ledgerNetsToZero(r.settlements);
    expect(r.summary.nowNote).toMatch(/carrying/); // holes 7-18 all tie
  });
  it("net skins use allocated strokes", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 18)]);
    const r = runGame(skinsGame, c, { basis: "NET", skinValueCents: 100, carryover: false }, entriesFor({ a: par(), b: par() }));
    expect(r.state.skinsByPlayer.b).toBe(18);
    expect(r.state.skinsByPlayer.a).toBe(0);
  });
  it("no carryover mode resets on ties", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0)]);
    const r = runGame(skinsGame, c, { basis: "GROSS", skinValueCents: 100, carryover: false }, entriesFor({ a: withHole(par(), 5, 3), b: par() }));
    expect(r.state.results[4].skins).toBe(1);
  });
});

describe("match play", () => {
  const two = () => ctx([player("a", "A", 0), player("b", "B", 0)]);
  it("tracks AS / X UP and closes at 18", () => {
    const r = runGame(matchPlayGame, two(), { basis: "GROSS", amountCents: 1000, sideA: ["a"], sideB: ["b"] }, entriesFor({ a: withHole(par(), 18, 3), b: par() }));
    expect(r.state.match.status).toBe("1 UP");
    expect(r.state.match.winner).toBe("A");
    expect(r.settlements).toEqual([{ fromPlayerId: "b", toPlayerId: "a", amountCents: 1000, memo: "Match play (1 UP)" }]);
  });
  it("halved match pays nothing", () => {
    const r = runGame(matchPlayGame, two(), { basis: "GROSS", amountCents: 1000, sideA: ["a"], sideB: ["b"] }, entriesFor({ a: par(), b: par() }));
    expect(r.state.match.status).toBe("HALVED");
    expect(r.settlements).toEqual([]);
  });
  it("detects dormie and closes early with X&Y notation", () => {
    let a = par();
    for (const h of [1, 2, 4, 5]) a = withHole(a, h, 3); // 4 UP after 5 (hole 3 is a par 3)
    const partial = entriesFor({ a: a.slice(0, 14), b: par().slice(0, 14) });
    const mid = runGame(matchPlayGame, two(), { basis: "GROSS", sideA: ["a"], sideB: ["b"] }, partial);
    expect(mid.state.match.status).toBe("4 UP");
    expect(mid.state.match.dormie).toBe(true); // 4 up with 4 to play
    const full = runGame(matchPlayGame, two(), { basis: "GROSS", sideA: ["a"], sideB: ["b"] }, entriesFor({ a: withHole(a, 15, 3), b: par() }));
    expect(full.state.match.closed).toBe(true);
    expect(full.state.match.status).toBe("5&3");
    expect(full.state.match.holesPlayed).toBe(15);
  });
  it("rejects a player on both sides", () => {
    expect(matchPlayGame.validateRules({ basis: "GROSS", amountCents: 0, sideA: ["a"], sideB: ["a"], }).ok).toBe(false);
  });
});

describe("match play handicapping", () => {
  // A: CH 7 (full strokes on SI 1-7). B: CH 14 (full strokes on SI 1-14).
  // B bogeys the SI 1-7 holes; A bogeys the SI 8-14 holes; everything else is par.
  const holes = course18();
  const aScores = holes.map((h) => h.par + (h.strokeIndex >= 8 && h.strokeIndex <= 14 ? 1 : 0));
  const bScores = holes.map((h) => h.par + (h.strokeIndex <= 7 ? 1 : 0));
  it("RELATIVE (default): B gets 7 strokes on SI 1-7 only, so B's bogeys are halved and A's bogeys lose", () => {
    const c = ctx([player("a", "A", 7), player("b", "B", 14)]);
    const r = runGame(matchPlayGame, c, { basis: "NET", sideA: ["a"], sideB: ["b"] }, entriesFor({ a: aScores, b: bScores }));
    expect(r.state.match.winner).toBe("B");
    expect(r.state.ctx.players.find((p) => p.playerId === "a")!.allocation).toEqual(allocateStrokes(0, holes));
    expect(r.state.ctx.players.find((p) => p.playerId === "b")!.allocation).toEqual(allocateStrokes(7, holes));
  });
  it("FULL: both take every stroke, which cancels out to a halved match", () => {
    const c = ctx([player("a", "A", 7), player("b", "B", 14)]);
    const r = runGame(matchPlayGame, c, { basis: "NET", handicapMode: "FULL", sideA: ["a"], sideB: ["b"] }, entriesFor({ a: aScores, b: bScores }));
    expect(r.state.match.status).toBe("HALVED");
  });
  it("Nassau uses the same relative strokes", () => {
    const c = ctx([player("a", "A", 7), player("b", "B", 14)]);
    const r = runGame(nassauGame, c, { basis: "NET", amountCents: 500, sideA: ["a"], sideB: ["b"] }, entriesFor({ a: aScores, b: bScores }));
    expect(r.state.overall.winner).toBe("B");
    expect(r.settlements.every((st) => st.toPlayerId === "b")).toBe(true);
  });
});

describe("nassau", () => {
  it("settles front, back and overall independently", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0)]);
    let a = par();
    a = withHole(a, 2, 3); // A wins front 1 UP
    let b = par();
    b = withHole(b, 10, 3);
    b = withHole(b, 12, 4); // B wins back 2 UP, overall B 1 UP
    const r = runGame(nassauGame, c, { basis: "GROSS", amountCents: 2000, sideA: ["a"], sideB: ["b"] }, entriesFor({ a, b }));
    expect(r.state.front.winner).toBe("A");
    expect(r.state.back.winner).toBe("B");
    expect(r.state.overall.winner).toBe("B");
    expect(r.settlements).toEqual([
      { fromPlayerId: "b", toPlayerId: "a", amountCents: 2000, memo: "Nassau front 9 (1 UP)" },
      { fromPlayerId: "a", toPlayerId: "b", amountCents: 2000, memo: "Nassau back 9 (2&1)" },
      { fromPlayerId: "a", toPlayerId: "b", amountCents: 2000, memo: "Nassau overall (1 UP)" },
    ]);
    ledgerNetsToZero(r.settlements);
  });
  it("supports team sides with best ball and net strokes", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0), player("c", "C", 0), player("d", "D", 18)]);
    // d gets a stroke every hole -> net birdie every hole -> side B wins everything 9&8 style
    const r = runGame(nassauGame, c, { basis: "NET", amountCents: 500, sideA: ["a", "b"], sideB: ["c", "d"] }, entriesFor({ a: par(), b: par(), c: par(), d: par() }));
    expect(r.state.front.status).toBe("5&4");
    expect(r.state.overall.status).toBe("10&8");
    // each of a,b pays 500 per segment split across c,d
    expect(r.settlements.reduce((s, x) => s + x.amountCents, 0)).toBe(3 * 2 * 500);
    ledgerNetsToZero(r.settlements);
  });
});

describe("stableford", () => {
  it("maps points from the table and clamps", () => {
    const c = ctx([player("a", "A", 0), player("b", "B", 0)]);
    let a = par();
    a = withHole(a, 1, 2); // eagle 4
    a = withHole(a, 2, 4); // birdie 3
    a = withHole(a, 3, 8); // clamps to 0
    const r = runGame(stablefordGame, c, { basis: "GROSS" }, entriesFor({ a, b: par() }));
    expect(r.state.points.b).toBe(36);
    expect(r.state.points.a).toBe(36 - 2 - 2 - 2 + 4 + 3 + 0);
  });
});

describe("best ball", () => {
  it("uses team best net score per hole", () => {
    const teams = [
      { teamId: "blue", name: "Blue", playerIds: ["a", "b"] },
      { teamId: "red", name: "Red", playerIds: ["c", "d"] },
    ];
    const c = ctx([player("a", "A", 0), player("b", "B", 0), player("c", "C", 0), player("d", "D", 5)], teams);
    const r = runGame(bestBallGame, c, { basis: "NET", stakeCents: 1000 }, entriesFor({ a: par(), b: par(), c: par(), d: par() }));
    expect(r.state.teamTotals.blue).toBe(72);
    expect(r.state.teamTotals.red).toBe(67);
    expect(r.settlements).toHaveLength(4);
    ledgerNetsToZero(r.settlements);
  });
});
