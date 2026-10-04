import { describe, expect, it } from "vitest";
import { seedState, PAST_TRIP_ID, addPastPinehurstRounds } from "../../prototype/store";
import { holeMemory } from "../../prototype/memory";

describe("course memory", () => {
  const state = seedState();
  const live = state.rounds.find((r) => r.status === "LIVE")!;
  it("seeds last year's two locked rounds once, with Matt's shots tied to a tee strategy", () => {
    const past = state.rounds.filter((r) => r.tripId === PAST_TRIP_ID);
    expect(past.map((r) => r.status)).toEqual(["LOCKED", "LOCKED"]);
    addPastPinehurstRounds(state);
    expect(state.rounds.filter((r) => r.tripId === PAST_TRIP_ID)).toHaveLength(2);
    for (const r of past) {
      const tees = r.shots!.filter((s) => s.playerId === "p_matt" && s.seq === 1);
      expect(tees).toHaveLength(18);
      expect(tees.every((s) => ["safe", "balanced", "attack"].includes(s.plan!.kind!))).toBe(true);
      // the card adds up: tracked shots set every score, and every hole is holed out
      for (let h = 1; h <= 18; h++) {
        const shots = r.shots!.filter((s) => s.playerId === "p_matt" && s.holeNumber === h);
        expect(shots[shots.length - 1].holed).toBe(true);
        expect(r.scores.find((x) => x.entry.playerId === "p_matt" && x.entry.holeNumber === h)!.entry.grossScore).toBe(shots.length);
      }
    }
    expect(state.actorId).toBe("p_matt");
  });
  it("recalls each visit newest first with the plays chosen, and scores each tee strategy", () => {
    const mem = holeMemory(state, live.courseId, "p_matt", 5, live.id)!;
    expect(mem.visits.map((v) => v.roundName)).toEqual(["Round 3", "Round 1"]);
    expect(mem.visits[1].tee!.kind).toBe("attack");
    expect(mem.visits[1].tee!.club).toBe("Dr");
    expect(mem.visits[0].sg).not.toBeNull();
    expect(mem.average).toBeCloseTo((mem.visits[0].gross + mem.visits[1].gross) / 2);
    const total = mem.byTeeStrategy.reduce((a, b) => a + b.visits, 0);
    expect(total).toBe(2);
  });
  it("leaves out the round being played and players with no history", () => {
    expect(holeMemory(state, live.courseId, "p_matt", 1, live.id)!.visits.every((v) => v.roundId !== live.id)).toBe(true);
    expect(holeMemory(state, live.courseId, "p_nobody", 1, live.id)).toBeNull();
  });
});
