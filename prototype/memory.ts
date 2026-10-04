/**
 * Course memory: what this player did on this hole in earlier rounds on the same course —
 * the score, the play they chose off the tee and into the green, how it came out, and
 * strokes gained — plus how each tee strategy has scored for them here.
 */
import { holeShapeFor, findScore, holeShots, type State } from "./store";
import { holeStrokesGained } from "./strokesGained";
import { isPutt, type Shot } from "./shots";
import type { SgTotals } from "../src/domain/strategy/strokesGained";

export type PlayKindOrOwn = NonNullable<NonNullable<Shot["plan"]>["kind"]>;
export interface ShotRecall { club: Shot["club"]; kind: PlayKindOrOwn | null; aimOffset: number | null; result: Shot["lie"]; distance: number }
export interface HoleVisit {
  roundId: string; roundName: string; tripName: string; date: string | null;
  gross: number; toPar: number; putts: number | null;
  tee: ShotRecall | null; approach: ShotRecall | null;
  sg: SgTotals | null;
}
export interface HoleMemory {
  visits: HoleVisit[];
  average: number; best: number;
  /** How each tee strategy has scored here: average to par over the visits that used it. */
  byTeeStrategy: { kind: PlayKindOrOwn; visits: number; avgToPar: number }[];
}

const recall = (s: Shot | undefined): ShotRecall | null => (s ? { club: s.club, kind: s.plan?.kind ?? (s.plan ? "balanced" : null), aimOffset: s.plan ? s.plan.aimOffset : null, result: s.lie, distance: s.distance } : null);

export function holeMemory(state: State, courseId: string, playerId: string, holeNumber: number, excludeRoundId: string): HoleMemory | null {
  const course = state.courses.find((c) => c.id === courseId);
  const hole = course?.holes.find((h) => h.holeNumber === holeNumber);
  const player = state.players.find((p) => p.id === playerId);
  if (!course || !hole || !player) return null;
  const rounds = state.rounds
    .filter((r) => r.id !== excludeRoundId && r.courseId === courseId && r.players.some((p) => p.playerId === playerId))
    .sort((a, b) => (b.startsAt ?? "").localeCompare(a.startsAt ?? ""));
  const flag = holeShapeFor(state, courseId, holeNumber).green.c;
  const visits: HoleVisit[] = [];
  for (const r of rounds) {
    const e = findScore(r, playerId, holeNumber).entry;
    if (e.grossScore === null) continue;
    const shots = holeShots(r, playerId, holeNumber);
    const full = shots.filter((s) => !isPutt(s));
    const holed = shots.length > 0 && shots[shots.length - 1].holed === true;
    visits.push({
      roundId: r.id, roundName: r.name, tripName: state.trips.find((t) => t.id === r.tripId)?.name ?? "", date: r.startsAt,
      gross: e.grossScore, toPar: e.grossScore - hole.par, putts: e.putts,
      tee: recall(full[0]), approach: recall(full.length > 1 ? full[full.length - 1] : undefined),
      sg: holed ? holeStrokesGained(shots, flag, hole.par, player.handicapIndex, "handicap").totals : null,
    });
  }
  if (!visits.length) return null;
  const groups = new Map<PlayKindOrOwn, number[]>();
  for (const v of visits) if (v.tee?.kind) groups.set(v.tee.kind, [...(groups.get(v.tee.kind) ?? []), v.toPar]);
  const order: PlayKindOrOwn[] = ["safe", "balanced", "attack", "own"];
  return {
    visits,
    average: visits.reduce((a, v) => a + v.gross, 0) / visits.length,
    best: Math.min(...visits.map((v) => v.gross)),
    byTeeStrategy: order.filter((k) => groups.has(k)).map((k) => { const xs = groups.get(k)!; return { kind: k, visits: xs.length, avgToPar: xs.reduce((a, b) => a + b, 0) / xs.length }; }),
  };
}
