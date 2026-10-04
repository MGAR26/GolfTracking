/**
 * Browser-side store for the clickable prototype. It mirrors the server services
 * (round creation, versioned score saves, side bets, lock/reopen, ledger) on top of the
 * same domain package the real app uses, so every number here is the production math.
 */
import type { HoleEntry, HoleInfo, RoundPlayerInfo } from "../src/domain/types";
import { emptyHoleEntry } from "../src/domain/types";
import { allocateStrokes, calculateCourseHandicap, calculatePlayingHandicap } from "../src/domain/handicap";
import { buildLeaderboard, computePlayerRoundTotals, type LeaderboardRow, type PlayerRoundTotals } from "../src/domain/scoring";
import { getGameDefinition, runGame, type GameContext, type GameSettlement, type LiveGameSummary } from "../src/domain/games";
import { computeRoundStats, type RoundStats } from "../src/domain/stats";
import { computeNetBalances, computePairwiseObligations, type LedgerEntry } from "../src/domain/ledger";
import { optimizeSettlement } from "../src/domain/settlement";
import { assertCanAccept, assertCanSettle, autoResolve, isFullyAccepted, settlementsForSideBet, type SideBet, type SideBetType } from "../src/domain/side-bets";
import { canEditScore, type ScoringMode, type TripRole } from "../src/server/services/permissions";
import { buildHole, buildRealHole, dist, lieAt, type Conditions, type HoleShape, type Pt } from "./holeGeometry";
import type { SgBaseline } from "./strokesGained";
import { expectedStrokes } from "../src/domain/strategy/expectedStrokes";
import type { RealCourse } from "./osmCourse";
import { dispersionModel, sampleShot, type Bag, type ClubProfile } from "./bag";
import pinehurst4Json from "./courses/pinehurst-4.json";
const PINEHURST_4 = pinehurst4Json as unknown as RealCourse;
import { isPutt, shotFrom, suggestClub, CLUBS, type Club, type Shape, type Shot, type Trajectory, type Lie } from "./shots";

export interface Player { id: string; name: string; handicapIndex: number; favoriteYardages?: number[]; /** Per-club carry and miss profile the player entered. */ bag?: Bag }
export interface Trip { id: string; name: string; destination: string | null; startDate: string | null; endDate: string | null; ownerId: string; playerIds: string[] }
export interface Course { id: string; name: string; teeName: string; par: number; courseRating: number; slopeRating: number; holes: HoleInfo[] }
export interface RoundPlayer { playerId: string; handicapIndexSnapshot: number; courseHandicap: number; playingHandicap: number }
export interface Game { id: string; type: string; name: string; rules: Record<string, unknown>; participantIds: string[]; teams: { teamId: string; name: string; playerIds: string[] }[]; status: "ACTIVE" | "FINALIZED" }
export interface StoredSideBet extends SideBet { holeNumber: number | null; createdAt: string; resolution: { winnerSide: string | null; winnerPlayerId: string | null; resolvedAt: string } | null }
export interface ScoreRow { entry: HoleEntry; version: number; updatedBy: string }
export interface Round {
  id: string; tripId: string; courseId: string; name: string; startsAt: string | null; countsTowardTrip: boolean;
  scoringMode: ScoringMode; scorerPlayerId: string | null; status: "LIVE" | "LOCKED";
  players: RoundPlayer[]; scores: ScoreRow[]; games: Game[]; sideBets: StoredSideBet[]; shots?: Shot[];
  /** Playing groups (foursomes). A round without groups is one group. */
  groups?: { name: string; playerIds: string[] }[];
}
export interface State { players: Player[]; trips: Trip[]; courses: Course[]; rounds: Round[]; ledger: LedgerEntry[]; actorId: string; audit: { at: string; actorId: string; action: string; detail: string }[]; wind?: { mph: number; fromDeg: number }; /** Aim point set for the next shot, keyed round:player:hole. */ pendingAims?: Record<string, Pt>; /** Whose shots to draw on the hole view. */ shotFilter?: ShotFilter; /** Scorecard strip: gross, net or both. */ scorecardView?: ScorecardView; /** Real hole outlines loaded from OpenStreetMap, by course id. */ courseGeometry?: Record<string, RealCourse>; /** Side-bet notices the player closed on a hole (round:hole:bet). */ dismissedBetNotes?: string[]; /** Day conditions for plays-like (temperature, altitude, turf). */ conditions?: Partial<Conditions>; /** Draw the baked satellite photo under the hole (default on). */ satellite?: boolean; /** Strokes gained shown against the player's own handicap or scratch. */ sgBaseline?: SgBaseline; /** Rounds where shot tracking is on, as round:player, so it stays on from hole to hole. */ tracking?: string[] }
export type ScorecardView = "gross" | "net" | "both";
export type ShotFilterMode = "me" | "group" | "all" | "custom";
export interface ShotFilter { mode: ShotFilterMode; playerIds: string[] }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

/** Hole card for the demo course: par and yardage come from the mapped holes (straight-line tee to green), stroke index is ours. */
const STROKE_INDEX = [7, 3, 15, 1, 11, 17, 5, 9, 13, 4, 16, 2, 12, 6, 10, 18, 8, 14];
export const SEED_HOLES: HoleInfo[] = STROKE_INDEX.map((strokeIndex, i) => {
  const real = PINEHURST_4.holes[i + 1];
  const yardage = real ? Math.round(real.length) : 400;
  const par = real?.par ?? 4;
  return { holeNumber: i + 1, par, yardage, strokeIndex };
});

export function seedState(): State {
  const players: Player[] = [
    { id: "p_matt", name: "Matt", handicapIndex: 5.2 },
    { id: "p_marcus", name: "Marcus", handicapIndex: 11.4 },
    { id: "p_ryan", name: "Ryan", handicapIndex: 8.7 },
    { id: "p_john", name: "John", handicapIndex: 14.1 },
  ];
  const course: Course = { id: "c_pinehurst4", name: "Pinehurst No. 4", teeName: "Blue", par: SEED_HOLES.reduce((a, h) => a + h.par, 0), courseRating: 72.4, slopeRating: 135, holes: SEED_HOLES };
  const trip: Trip = { id: "t_pinehurst", name: "Pinehurst Trip 2026", destination: "Pinehurst, NC", startDate: "2026-10-09", endDate: "2026-10-11", ownerId: "p_matt", playerIds: players.map((p) => p.id) };
  const state: State = { players, trips: [trip], courses: [course], rounds: [], ledger: [], actorId: "p_matt", audit: [], courseGeometry: { [course.id]: PINEHURST_4 } };
  createRound(state, {
    tripId: trip.id, courseId: course.id, name: "Round 1", startsAt: "2026-10-09T09:20", countsTowardTrip: true, scoringMode: "HYBRID", scorerPlayerId: "p_matt",
    playerIds: players.map((p) => p.id),
    games: [
      { type: "STROKE_PLAY", name: "Net Stroke Play", rules: { basis: "NET", stakeCents: 0 } },
      { type: "SKINS", name: "$5 Skins", rules: { basis: "NET", skinValueCents: 500, carryover: true, voidUnclaimed: true } },
      { type: "NASSAU", name: "$20 Nassau", rules: { basis: "NET", amountCents: 2000, sideA: ["p_matt", "p_ryan"], sideB: ["p_marcus", "p_john"], presses: false } },
    ],
  });
  const round = state.rounds[0];
  // Holes 1–3 at Pinehurst No. 4 are all par 4s.
  const seedScores: Record<string, [number, number | null, boolean | null, HoleEntry["fairwayResult"]][]> = {
    p_matt: [[4, 2, true, "HIT"], [4, 2, true, "HIT"], [4, 2, true, "LEFT"]],
    p_marcus: [[5, 2, false, "LEFT"], [5, 2, false, "HIT"], [4, 2, true, "HIT"]],
    p_ryan: [[4, 1, false, "RIGHT"], [5, 2, true, "HIT"], [3, 1, true, "HIT"]],
    p_john: [[6, 2, false, "LEFT"], [5, 3, false, "RIGHT"], [5, 2, false, "LEFT"]],
  };
  for (const [pid, arr] of Object.entries(seedScores)) {
    arr.forEach(([grossScore, putts, gir, fairwayResult], i) => {
      round.scores.push({ entry: { ...emptyHoleEntry(pid, i + 1), grossScore, putts, gir, fairwayResult }, version: 1, updatedBy: "p_matt" });
    });
  }
  // Side bets: a long-drive contest on 5 (accepted) and a closest-to-pin on the par-3 4th (still waiting on John).
  const ld = createSideBet(state, { roundId: round.id, type: "LONGEST_DRIVE_IN_FAIRWAY", description: "Longest drive in the fairway", amountCents: 2000, basis: "GROSS", holeNumbers: [5], opponentIds: ["p_marcus"] }, "p_matt");
  acceptSideBet(state, round.id, ld, "p_marcus");
  createSideBet(state, { roundId: round.id, type: "CLOSEST_TO_PIN", description: "Closest to the pin", amountCents: 1000, basis: "GROSS", holeNumbers: [4], opponentIds: ["p_john"] }, "p_ryan");
  const hw = createSideBet(state, { roundId: round.id, type: "HOLE_WINNER", description: "Hole winner", amountCents: 1000, basis: "GROSS", holeNumbers: [2], opponentIds: ["p_ryan"] }, "p_matt");
  acceptSideBet(state, round.id, hw, "p_ryan");
  resolveSideBet(state, round.id, hw, "AUTO", "p_matt");
  round.groups = [{ name: "Group A", playerIds: ["p_matt", "p_ryan"] }, { name: "Group B", playerIds: ["p_marcus", "p_john"] }];
  // Everyone tracked shots on the holes already played (shots = gross − putts), plus the group ahead on hole 4.
  const tracked: Record<string, number[]> = { p_matt: [2, 2, 2], p_marcus: [3, 3, 2, 2], p_ryan: [3, 3, 2], p_john: [4, 2, 3, 2] };
  Object.entries(tracked).forEach(([pid, counts], pi) => counts.forEach((n, hi) => seedHoleShots(state, round, pid, hi + 1, n, pi * 7 + hi)));
  addPastPinehurstRounds(state);
  return state;
}
/** Deterministic, plausible rest points for a seeded hole: long shots first, last one on or beside the green. */
function seedHoleShots(state: State, round: Round, playerId: string, holeNumber: number, n: number, salt: number, kinds: NonNullable<Shot["plan"]>["kind"][] | null = playerId === state.actorId ? [] : null) {
  const shape = holeShapeFor(state, round.courseId, holeNumber);
  const green = shape.green.c;
  const rnd = (i: number) => { const x = Math.sin(salt * 97.3 + i * 13.7 + holeNumber * 3.1) * 10000; return x - Math.floor(x); };
  let from: Pt = { u: 0, v: 0 };
  round.shots ??= [];
  for (let i = 1; i <= n; i++) {
    const last = i === n;
    const remaining = Math.hypot(green.u - from.u, green.v - from.v);
    const to: Pt = last
      ? { u: green.u + (rnd(i) - 0.5) * 22, v: green.v + (rnd(i + 50) - 0.5) * 26 }
      : { u: from.u + Math.min(remaining - 40, 150 + rnd(i) * 130), v: from.v + (rnd(i + 50) - 0.5) * 60 };
    const l = lieAt(shape, to);
    const shot: Shot = { id: `seed_${playerId}_${holeNumber}_${i}`, ...shotFrom(from, to, playerId, holeNumber, i, round.shots), lie: last ? "green" : l === "water" ? "rough" : l };
    if (kinds) {
      // the play Matt "chose" before each seeded shot: priced like the benchmark from that spot
      const hcp = state.players.find((p) => p.id === playerId)?.handicapIndex ?? 0;
      const startLie = i === 1 ? "tee" : (round.shots.find((x) => x.id === `seed_${playerId}_${holeNumber}_${i - 1}`)?.lie ?? "fairway");
      shot.plan = { club: shot.club, aimOffset: 0, expected: expectedStrokes({ distanceYards: remaining, lie: startLie === "fringe" ? "fairway" : startLie, handicapIndex: hcp }), kind: kinds[i - 1] ?? "balanced" };
    }
    round.shots.push(shot);
    from = to;
  }
}
/** Tee club, carry and spray for each strategy (par 4s and 5s); par 3s use the club for the distance. */
const TEE_PLAY = { safe: { club: "Hy" as Club, carry: 205, spray: 10 }, balanced: { club: "3W" as Club, carry: 230, spray: 16 }, attack: { club: "Dr" as Club, carry: 262, spray: 26 } };
/**
 * One remembered hole played to a plan: the tee shot follows the strategy (attack = driver long and
 * wild, safe = hybrid short and straight), par 5s lay up to a wedge, a bogey adds a recovery shot,
 * and the last full shot finishes on the green. Every full shot records the play it came from.
 */
function seedPlannedHole(state: State, round: Round, playerId: string, holeNumber: number, tee: "safe" | "balanced" | "attack", extra: number, salt: number) {
  const shape = holeShapeFor(state, round.courseId, holeNumber);
  const green = shape.green.c;
  const par = state.courses.find((c) => c.id === round.courseId)!.holes.find((x) => x.holeNumber === holeNumber)!.par;
  const hcp = state.players.find((p) => p.id === playerId)?.handicapIndex ?? 0;
  const rnd = (i: number) => { const x = Math.sin(salt * 91.7 + i * 17.3 + holeNumber * 5.9) * 10000; return x - Math.floor(x); };
  const along = (u: number): Pt => {
    for (let i = 0; i < shape.line.length - 1; i++) { const a = shape.line[i], b = shape.line[i + 1]; if (u >= a.u && u <= b.u) { const f = (u - a.u) / (b.u - a.u || 1); return { u, v: a.v + (b.v - a.v) * f }; } }
    return shape.line[shape.line.length - 1];
  };
  const targets: { to: Pt; club?: Club; kind: "safe" | "balanced" | "attack" }[] = [];
  if (par >= 4) {
    const t = TEE_PLAY[tee];
    const p = along(Math.min(t.carry + (rnd(1) - 0.4) * 18, shape.length - 60));
    targets.push({ to: { u: p.u, v: p.v + (rnd(2) - 0.5) * 2 * t.spray }, club: t.club, kind: tee });
    if (extra) { const q = along(Math.min(targets[0].to.u + 70, shape.length - 110)); targets.push({ to: { u: q.u, v: q.v + (rnd(3) - 0.5) * 12 }, kind: "safe" }); } // punch back to the fairway
    if (par === 5) { const q = along(shape.length - 95 - rnd(4) * 20); targets.push({ to: { u: q.u, v: q.v + (rnd(5) - 0.5) * 14 }, kind: tee === "attack" ? "attack" : "safe" }); }
  } else if (extra) {
    targets.push({ to: { u: green.u - 18 - rnd(6) * 8, v: green.v + (rnd(7) - 0.5) * 24 }, kind: tee }); // missed the green short
  }
  targets.push({ to: { u: green.u + (rnd(8) - 0.5) * 2 * Math.max(3, shape.green.ru * 0.5), v: green.v + (rnd(9) - 0.5) * 2 * Math.max(3, shape.green.rv * 0.5) }, kind: par === 3 && !extra ? tee : "balanced" });
  round.shots ??= [];
  let from: Pt = { u: 0, v: 0 };
  targets.forEach((tg, i) => {
    const last = i === targets.length - 1;
    const base = shotFrom(from, tg.to, playerId, holeNumber, i + 1, round.shots!);
    const l = lieAt(shape, tg.to);
    const startLie = i === 0 ? "tee" : (round.shots!.find((x) => x.id === `past_${round.id}_${holeNumber}_${i}`)?.lie ?? "fairway");
    round.shots!.push({
      id: `past_${round.id}_${holeNumber}_${i + 1}`, ...base, club: tg.club ?? base.club, lie: last ? "green" : l === "water" ? "rough" : l,
      plan: { club: tg.club ?? base.club, aimOffset: 0, expected: expectedStrokes({ distanceYards: dist(from, green), lie: startLie === "fringe" ? "fairway" : startLie, handicapIndex: hcp }), kind: tg.kind },
    });
    from = tg.to;
  });
}
/**
 * Last year's trip: two locked rounds on Pinehurst No. 4, so course memory has something to show.
 * The actor's shots are tracked with the play they chose off each tee; everyone else has scores.
 * Safe to call on an existing saved demo: it does nothing once the trip is there.
 */
export const PAST_TRIP_ID = "t_pinehurst_2025";
export function addPastPinehurstRounds(state: State) {
  const course = state.courses.find((c) => c.id === "c_pinehurst4");
  const ids = ["p_matt", "p_marcus", "p_ryan", "p_john"];
  if (!course || state.trips.some((t) => t.id === PAST_TRIP_ID) || !ids.every((id) => state.players.some((p) => p.id === id))) return;
  state.trips.push({ id: PAST_TRIP_ID, name: "Pinehurst Trip 2025", destination: "Pinehurst, NC", startDate: "2025-10-10", endDate: "2025-10-12", ownerId: "p_matt", playerIds: ids });
  const actor = state.actorId;
  state.actorId = "p_matt"; // the scorer enters everything, as on the day
  const KINDS = ["safe", "balanced", "attack"] as const;
  [["Round 1", "2025-10-10T09:00", 0], ["Round 3", "2025-10-12T08:40", 1]].forEach(([name, startsAt, r]) => {
    const roundId = createRound(state, { tripId: PAST_TRIP_ID, courseId: course.id, name: name as string, startsAt: startsAt as string, countsTowardTrip: true, scoringMode: "HYBRID", scorerPlayerId: "p_matt", playerIds: ids, games: [] });
    const round = state.rounds.find((x) => x.id === roundId)!;
    const k = r as number;
    for (const h of course.holes) {
      // Matt: tracked shot by shot. Tee play rotates through safe / balanced / attack across the two visits;
      // attacking holes cost a stroke now and then, which is the point of remembering.
      const tee = KINDS[(h.holeNumber + k * 2) % 3];
      const extra = (tee === "attack" && (h.holeNumber + k) % 2 === 0) || (h.holeNumber * 7 + k * 3) % 9 === 0 ? 1 : 0;
      seedPlannedHole(state, round, "p_matt", h.holeNumber, tee, extra, 40 + h.holeNumber * 3 + k * 11);
      const putts = (h.holeNumber + k) % 5 === 0 ? 1 : (h.holeNumber * 3 + k) % 7 === 0 ? 3 : 2;
      if (putts === 3) logPutt(state, roundId, "p_matt", h.holeNumber, 7);
      if (putts >= 2) logPutt(state, roundId, "p_matt", h.holeNumber, 3);
      logPutt(state, roundId, "p_matt", h.holeNumber, null);
      // Everyone else: a believable card for their handicap.
      ids.slice(1).forEach((pid, pi) => {
        const over = [1, 1, 2][pi] + ((h.holeNumber * (pi + 3) + k * 5) % 4 === 0 ? 1 : 0) - ((h.holeNumber + pi + k) % 6 === 0 ? 1 : 0);
        const gross = Math.max(h.par - 1, h.par + over - (pi === 1 ? 1 : 0));
        round.scores.push({ entry: { ...emptyHoleEntry(pid, h.holeNumber), grossScore: gross, putts: 2 }, version: 1, updatedBy: "p_matt" });
      });
    }
    finishRound(state, roundId);
  });
  state.actorId = actor;
}
/** Players in the same playing group as `playerId` (everyone when the round has no groups). */
export function groupMates(round: Round, playerId: string): string[] {
  const g = (round.groups ?? []).find((x) => x.playerIds.includes(playerId));
  return g ? g.playerIds : round.players.map((p) => p.playerId);
}
export function setShotFilter(state: State, filter: ShotFilter) { state.shotFilter = filter; }
export function setScorecardView(state: State, view: ScorecardView) { state.scorecardView = view; }
export function setConditions(state: State, patch: Partial<Conditions>) { state.conditions = { ...(state.conditions ?? {}), ...patch }; }
export const satelliteOn = (state: State) => state.satellite !== false;
export const sgBaseline = (state: State): SgBaseline => state.sgBaseline ?? "handicap";
/** Shot tracking is a per-round, per-player switch: once on, every hole opens ready to mark the ball. */
export const trackingOn = (state: State, roundId: string, playerId: string) => (state.tracking ?? []).includes(`${roundId}:${playerId}`);
export function setTrackingOn(state: State, roundId: string, playerId: string, on: boolean) {
  const key = `${roundId}:${playerId}`;
  const rest = (state.tracking ?? []).filter((k) => k !== key);
  state.tracking = on ? [...rest, key] : rest;
}
export function setSgBaseline(state: State, b: SgBaseline) { state.sgBaseline = b; }
export function setSatellite(state: State, on: boolean) { state.satellite = on; }
export function setClubProfile(state: State, playerId: string, club: Club, profile: ClubProfile | null) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  p.bag ??= {};
  if (profile) p.bag[club] = profile; else delete p.bag[club];
}
/** Dispersion for a player's club: their profile blended with their aimed shots. */
export function playerDispersion(state: State, round: Round, playerId: string, club: Club) {
  const p = state.players.find((x) => x.id === playerId)!;
  return dispersionModel(club, p.bag ?? {}, p.handicapIndex, round.shots ?? [], playerId);
}
export function restoreBetNote(state: State, roundId: string, holeNumber: number, betId: string) {
  state.dismissedBetNotes = (state.dismissedBetNotes ?? []).filter((k) => k !== `${roundId}:${holeNumber}:${betId}`);
}
export function dismissBetNote(state: State, roundId: string, holeNumber: number, betId: string) {
  state.dismissedBetNotes ??= [];
  state.dismissedBetNotes.push(`${roundId}:${holeNumber}:${betId}`);
}
/** Money up or down so far this round: games as if they ended now (posted ones once locked) plus settled side bets. */
/** Money that can be pinned to a hole, by hole: skins (the memo names the hole) and single-hole side bets.
 *  Nassau, match play and stroke play settle on segments or the round, so they are not in here. */
export function holeMoney(snap: Snapshot, playerId: string): Record<number, number> {
  const out: Record<number, number> = {};
  const add = (hole: number, cents: number) => { out[hole] = (out[hole] ?? 0) + cents; };
  const gameMoney = snap.round.status === "LIVE" ? snap.games.flatMap((g) => g.projected) : snap.ledger.filter((e) => e.sourceType === "GAME");
  for (const st of gameMoney) {
    const m = st.memo.match(/Hole (\d+)/);
    if (!m) continue;
    if (st.toPlayerId === playerId) add(Number(m[1]), st.amountCents);
    if (st.fromPlayerId === playerId) add(Number(m[1]), -st.amountCents);
  }
  for (const b of snap.sideBets) {
    if (b.status !== "SETTLED" || b.terms.holeNumbers.length !== 1 || !b.resolution?.winnerSide) continue;
    const mine = b.participants.find((p) => p.playerId === playerId);
    if (!mine) continue;
    const winners = b.participants.filter((p) => p.side === b.resolution!.winnerSide).length, losers = b.participants.length - winners;
    add(b.terms.holeNumbers[0], mine.side === b.resolution.winnerSide ? b.terms.amountCents * losers : -b.terms.amountCents * winners);
  }
  return out;
}
export function liveMoney(snap: Snapshot, playerId: string): number {
  const net = (list: { fromPlayerId: string; toPlayerId: string; amountCents: number }[]) => list.reduce((a, st) => a + (st.toPlayerId === playerId ? st.amountCents : 0) - (st.fromPlayerId === playerId ? st.amountCents : 0), 0);
  const games = snap.round.status === "LIVE" ? snap.games.flatMap((g) => g.projected) : snap.ledger.filter((e) => e.sourceType === "GAME");
  return net(games) + net(snap.ledger.filter((e) => e.sourceType === "SIDE_BET"));
}

/* ---------- trips ---------- */
export function createTrip(state: State, input: { name: string; destination: string; startDate: string; endDate: string; players: { name: string; handicapIndex: number }[] }): string {
  const players = input.players.map((p) => ({ id: uid(), name: p.name, handicapIndex: p.handicapIndex }));
  state.players.push(...players);
  const trip: Trip = { id: uid(), name: input.name, destination: input.destination || null, startDate: input.startDate || null, endDate: input.endDate || null, ownerId: players[0].id, playerIds: players.map((p) => p.id) };
  state.trips.push(trip);
  state.actorId = players[0].id;
  return trip.id;
}

export function tripRole(state: State, tripId: string, playerId: string): TripRole | null {
  const trip = state.trips.find((t) => t.id === tripId);
  if (!trip || !trip.playerIds.includes(playerId)) return null;
  return trip.ownerId === playerId ? "OWNER" : "PLAYER";
}

/* ---------- rounds ---------- */
export interface CreateRoundInput {
  tripId: string; courseId?: string; manualCourse?: { name: string; teeName: string; courseRating: number; slopeRating: number; holes: HoleInfo[] };
  name: string; startsAt: string; countsTowardTrip: boolean; scoringMode: ScoringMode; scorerPlayerId: string | null; playerIds: string[];
  games: { type: string; name: string; rules: Record<string, unknown>; teams?: { name: string; playerIds: string[] }[] }[];
}
export function createRound(state: State, input: CreateRoundInput): string {
  for (const g of input.games) {
    const v = getGameDefinition(g.type).validateRules(g.rules);
    if (!v.ok) throw new Error(`${g.name}: ${v.errors.join("; ")}`);
  }
  let course = state.courses.find((c) => c.id === input.courseId);
  if (!course) {
    if (!input.manualCourse) throw new Error("Pick a course");
    const m = input.manualCourse;
    course = { id: uid(), name: m.name, teeName: m.teeName, par: m.holes.reduce((a, h) => a + h.par, 0), courseRating: m.courseRating, slopeRating: m.slopeRating, holes: m.holes };
    state.courses.push(course);
  }
  const c = course;
  const round: Round = {
    id: uid(), tripId: input.tripId, courseId: c.id, name: input.name || `Round ${state.rounds.filter((r) => r.tripId === input.tripId).length + 1}`, startsAt: input.startsAt || null,
    countsTowardTrip: input.countsTowardTrip, scoringMode: input.scoringMode, scorerPlayerId: input.scoringMode === "INDIVIDUAL" ? null : input.scorerPlayerId ?? input.playerIds[0], status: "LIVE",
    players: input.playerIds.map((pid) => {
      const p = state.players.find((x) => x.id === pid)!;
      const ch = calculateCourseHandicap({ handicapIndex: p.handicapIndex, slopeRating: c.slopeRating, courseRating: c.courseRating, par: c.par });
      return { playerId: pid, handicapIndexSnapshot: p.handicapIndex, courseHandicap: ch.courseHandicap, playingHandicap: calculatePlayingHandicap(ch.courseHandicap, 100) };
    }),
    scores: [], sideBets: [],
    games: input.games.map((g) => {
      const teams = (g.teams ?? []).map((t) => ({ teamId: uid(), name: t.name, playerIds: t.playerIds }));
      return { id: uid(), type: g.type, name: g.name, rules: g.rules, participantIds: input.playerIds, teams, status: "ACTIVE" as const };
    }),
  };
  state.rounds.push(round);
  state.audit.push({ at: now(), actorId: state.actorId, action: "ROUND_CREATE", detail: round.name });
  return round.id;
}

export type SaveResult = { status: "saved"; version: number } | { status: "conflict"; current: ScoreRow } | { status: "forbidden"; reason: string };
export function saveScore(state: State, roundId: string, playerId: string, holeNumber: number, patch: Partial<HoleEntry>, expectedVersion: number): SaveResult {
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return { status: "forbidden", reason: "Round not found" };
  const allowed = canEditScore({ actorId: state.actorId, actorRole: tripRole(state, round.tripId, state.actorId), scoringMode: round.scoringMode, scorerPlayerId: round.scorerPlayerId, targetPlayerId: playerId, roundStatus: round.status });
  if (!allowed) return { status: "forbidden", reason: round.status !== "LIVE" ? "Round is locked" : "You cannot edit this player's score in this scoring mode" };
  const existing = round.scores.find((s) => s.entry.playerId === playerId && s.entry.holeNumber === holeNumber);
  if (existing && existing.version !== expectedVersion) return { status: "conflict", current: existing };
  if (!existing) {
    round.scores.push({ entry: { ...emptyHoleEntry(playerId, holeNumber), ...patch }, version: 1, updatedBy: state.actorId });
    return { status: "saved", version: 1 };
  }
  if (existing.entry.grossScore !== null && patch.grossScore !== undefined && patch.grossScore !== existing.entry.grossScore) {
    state.audit.push({ at: now(), actorId: state.actorId, action: "CHANGE_GROSS", detail: `${nameOf(state, playerId)} hole ${holeNumber}: ${existing.entry.grossScore} → ${patch.grossScore}` });
  }
  existing.entry = { ...existing.entry, ...patch };
  // A tracked hole derives its score: if putts or penalties change and shots are logged, the gross follows.
  if (patch.grossScore === undefined && (patch.putts !== undefined || patch.penaltyStrokes !== undefined)) {
    const strokes = holeShots(round, playerId, holeNumber).filter((s) => !isPutt(s)).length;
    if (strokes > 0 && existing.entry.putts !== null) existing.entry.grossScore = strokes + existing.entry.putts + existing.entry.penaltyStrokes;
  }
  existing.version += 1;
  existing.updatedBy = state.actorId;
  return { status: "saved", version: existing.version };
}

/* ---------- side bets ---------- */
export function createSideBet(state: State, input: { roundId: string; type: SideBetType; description: string; amountCents: number; basis: "GROSS" | "NET"; holeNumbers: number[]; opponentIds: string[] }, creatorId: string): string {
  const round = state.rounds.find((r) => r.id === input.roundId);
  if (!round || round.status !== "LIVE") throw new Error("Side bets can only be created on a live round");
  if (input.opponentIds.length === 0) throw new Error("Pick at least one opponent");
  if (input.opponentIds.includes(creatorId)) throw new Error("You cannot bet against yourself");
  const bet: StoredSideBet = {
    id: uid(), roundId: input.roundId, creatorId, status: "PROPOSED", holeNumber: input.holeNumbers.length === 1 ? input.holeNumbers[0] : null, createdAt: now(), resolution: null,
    terms: { type: input.type, description: input.description, amountCents: input.amountCents, holeNumbers: input.holeNumbers, basis: input.basis },
    participants: [{ playerId: creatorId, side: "A", acceptedAt: now() }, ...input.opponentIds.map((pid) => ({ playerId: pid, side: "B" as const, acceptedAt: null }))],
  };
  round.sideBets.push(bet);
  return bet.id;
}
function betOf(state: State, roundId: string, betId: string) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const bet = round.sideBets.find((b) => b.id === betId);
  if (!bet) throw new Error("Side bet not found");
  return { round, bet };
}
export function acceptSideBet(state: State, roundId: string, betId: string, actorId: string) {
  const { bet } = betOf(state, roundId, betId);
  assertCanAccept(bet, actorId);
  bet.participants = bet.participants.map((p) => (p.playerId === actorId ? { ...p, acceptedAt: now() } : p));
  if (isFullyAccepted(bet)) bet.status = "ACCEPTED";
}
export function declineSideBet(state: State, roundId: string, betId: string, actorId: string) {
  const { bet } = betOf(state, roundId, betId);
  if (bet.status !== "PROPOSED") throw new Error("Only a proposed bet can be declined");
  bet.status = bet.creatorId === actorId ? "CANCELLED" : "DECLINED";
}
export function resolveSideBet(state: State, roundId: string, betId: string, winner: "A" | "B" | "TIE" | "AUTO", actorId: string) {
  const { round, bet } = betOf(state, roundId, betId);
  assertCanSettle(bet);
  const snap = roundSnapshot(state, round.id);
  let result: "A" | "B" | "TIE";
  if (winner === "AUTO") {
    const auto = autoResolve(bet, snap.entries, (pid) => snap.players.find((p) => p.playerId === pid)?.allocation ?? {});
    if (!auto) throw new Error("This bet cannot be auto-resolved yet; pick the winner manually");
    result = auto;
  } else result = winner;
  const winnerPlayerId = result === "TIE" ? null : (bet.participants.find((p) => p.side === result)?.playerId ?? null);
  bet.resolution = { winnerSide: result === "TIE" ? null : result, winnerPlayerId, resolvedAt: now() };
  bet.status = result === "TIE" ? "VOID" : "SETTLED";
  if (result !== "TIE") {
    for (const st of settlementsForSideBet(bet, result, bet.terms.description)) {
      state.ledger.push({ id: uid(), tripId: round.tripId, roundId: round.id, sourceType: "SIDE_BET", sourceId: bet.id, fromPlayerId: st.fromPlayerId, toPlayerId: st.toPlayerId, amountCents: st.amountCents, status: "POSTED", memo: st.memo });
    }
  }
  state.audit.push({ at: now(), actorId, action: "SIDE_BET_RESOLVE", detail: `${bet.terms.description}: ${result}` });
}

/* ---------- finish / reopen ---------- */
export function finishProblems(state: State, roundId: string): string[] {
  const snap = roundSnapshot(state, roundId);
  const problems: string[] = [];
  if (snap.round.status !== "LIVE") problems.push("Round is locked");
  for (const p of snap.players) {
    const t = snap.totals[p.playerId];
    if (!t.isComplete) problems.push(`${p.displayName} has ${snap.holes.length - t.holesPlayed} hole(s) without a score`);
  }
  for (const b of snap.round.sideBets) {
    if (b.status === "PROPOSED") problems.push(`Side bet "${b.terms.description}" is still waiting for acceptance`);
    if (b.status === "ACCEPTED") problems.push(`Side bet "${b.terms.description}" has not been resolved`);
  }
  return problems;
}
export function finishRound(state: State, roundId: string) {
  const problems = finishProblems(state, roundId);
  if (problems.length) throw new Error(problems.join(". "));
  const snap = roundSnapshot(state, roundId);
  for (const g of snap.games) {
    const game = snap.round.games.find((x) => x.id === g.id)!;
    game.status = "FINALIZED";
    for (const st of g.settlements) {
      state.ledger.push({ id: uid(), tripId: snap.round.tripId, roundId, sourceType: "GAME", sourceId: g.id, fromPlayerId: st.fromPlayerId, toPlayerId: st.toPlayerId, amountCents: st.amountCents, status: "POSTED", memo: `${g.name}: ${st.memo}` });
    }
  }
  snap.round.status = "LOCKED";
  state.audit.push({ at: now(), actorId: state.actorId, action: "ROUND_LOCK", detail: snap.round.name });
}
export function reopenRound(state: State, roundId: string) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  if (round.status !== "LOCKED") throw new Error("Only a locked round can be reopened");
  for (const e of state.ledger.filter((e) => e.roundId === roundId && e.sourceType === "GAME" && e.status === "POSTED")) {
    e.status = "REVERSED";
    state.ledger.push({ id: uid(), tripId: e.tripId, roundId, sourceType: "REVERSAL", sourceId: e.sourceId, fromPlayerId: e.toPlayerId, toPlayerId: e.fromPlayerId, amountCents: e.amountCents, status: "REVERSED", memo: `Reversal of "${e.memo}" (organizer correction)`, reversesEntryId: e.id });
  }
  for (const g of round.games) g.status = "ACTIVE";
  round.status = "LIVE";
  state.audit.push({ at: now(), actorId: state.actorId, action: "ROUND_REOPEN", detail: round.name });
}

/** Remove a round. Locked rounds are reopened first so any posted money is reversed on the ledger, never lost. */
export function deleteRound(state: State, roundId: string) {
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return;
  if (tripRole(state, round.tripId, state.actorId) !== "OWNER") throw new Error("Only the trip organizer can delete a round");
  if (round.status === "LOCKED") reopenRound(state, roundId);
  state.rounds = state.rounds.filter((r) => r.id !== roundId);
  delete state.courseGeometry?.[round.courseId];
  if (state.pendingAims) for (const k of Object.keys(state.pendingAims)) if (k.startsWith(roundId + ":")) delete state.pendingAims[k];
  state.audit.push({ at: now(), actorId: state.actorId, action: "ROUND_DELETE", detail: round.name });
}

/* ---------- projections ---------- */
export interface ProjectedGame { id: string; type: string; name: string; rules: Record<string, unknown>; status: string; teams: GameContext["teams"]; summary: LiveGameSummary; settlements: GameSettlement[]; /** As if the round ended now. */ projected: GameSettlement[]; holesFinalized: number[] }
export interface ProjectedSideBet extends StoredSideBet { autoResult: "A" | "B" | "TIE" | null }
export interface Snapshot {
  round: Round; course: Course; holes: HoleInfo[];
  players: (RoundPlayerInfo & { playingHandicap: number; tripRole: TripRole | null })[];
  entries: HoleEntry[]; totals: Record<string, PlayerRoundTotals>; leaderboardNet: LeaderboardRow[]; leaderboardGross: LeaderboardRow[];
  stats: Record<string, RoundStats>; games: ProjectedGame[]; sideBets: ProjectedSideBet[]; currentHole: number | null; holesComplete: number; nowNotes: string[];
  /** Ledger entries posted for this round (not reversed). */
  ledger: LedgerEntry[];
}
export function nameOf(state: State, id: string | null | undefined): string {
  return state.players.find((p) => p.id === id)?.name ?? "?";
}
export function findScore(round: Round, playerId: string, holeNumber: number): ScoreRow {
  return round.scores.find((s) => s.entry.playerId === playerId && s.entry.holeNumber === holeNumber) ?? { entry: emptyHoleEntry(playerId, holeNumber), version: 0, updatedBy: "" };
}
export function roundSnapshot(state: State, roundId: string): Snapshot {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const course = state.courses.find((c) => c.id === round.courseId)!;
  const holes = course.holes;
  const players = round.players.map((rp) => ({
    playerId: rp.playerId, displayName: nameOf(state, rp.playerId), handicapIndex: rp.handicapIndexSnapshot, courseHandicap: rp.courseHandicap, playingHandicap: rp.playingHandicap,
    allocation: allocateStrokes(rp.playingHandicap, holes), tripRole: tripRole(state, round.tripId, rp.playerId),
  }));
  const entries = round.scores.map((s) => s.entry);
  const totals: Record<string, PlayerRoundTotals> = {};
  const stats: Record<string, RoundStats> = {};
  for (const p of players) {
    totals[p.playerId] = computePlayerRoundTotals(p.playerId, holes, p.allocation, entries);
    stats[p.playerId] = computeRoundStats(p.playerId, holes, entries);
  }
  const lb = players.map((p) => ({ playerId: p.playerId, displayName: p.displayName, totals: totals[p.playerId] }));
  const games: ProjectedGame[] = round.games.map((g) => {
    const ctx: GameContext = { gameId: g.id, holes, players: players.filter((p) => g.participantIds.includes(p.playerId)), teams: g.teams };
    const run = runGame(getGameDefinition(g.type), ctx, g.rules, entries);
    return { id: g.id, type: g.type, name: g.name, rules: g.rules, status: g.status, teams: g.teams, summary: run.summary, settlements: run.settlements, projected: run.projected, holesFinalized: run.holesFinalized };
  });
  const allocationFor = (pid: string) => players.find((p) => p.playerId === pid)?.allocation ?? {};
  const sideBets: ProjectedSideBet[] = round.sideBets.map((b) => ({ ...b, autoResult: b.status === "ACCEPTED" ? autoResolve(b, entries, allocationFor) : null }));
  let currentHole: number | null = null;
  let holesComplete = 0;
  for (const h of holes) {
    const done = players.every((p) => entries.some((e) => e.playerId === p.playerId && e.holeNumber === h.holeNumber && e.grossScore !== null));
    if (done) holesComplete++;
    else if (currentHole === null) currentHole = h.holeNumber;
  }
  const nowNotes: string[] = [];
  for (const g of games) if (g.summary.nowNote) nowNotes.push(g.summary.nowNote);
  if (currentHole !== null) for (const p of players) {
    const s = p.allocation[currentHole] ?? 0;
    if (s > 0) nowNotes.push(`${p.displayName} receives ${s === 1 ? "a stroke" : `${s} strokes`}`);
    if (s < 0) nowNotes.push(`${p.displayName} gives ${-s === 1 ? "a stroke" : `${-s} strokes`}`);
  }
  return { round, course, holes, players, entries, totals, leaderboardNet: buildLeaderboard(lb, "NET"), leaderboardGross: buildLeaderboard(lb, "GROSS"), stats, games, sideBets, currentHole, holesComplete, nowNotes, ledger: state.ledger.filter((e) => e.roundId === roundId && e.status !== "REVERSED") };
}

export function tripDashboard(state: State, tripId: string) {
  const trip = state.trips.find((t) => t.id === tripId)!;
  const members = trip.playerIds.map((id) => state.players.find((p) => p.id === id)!);
  const rounds = state.rounds.filter((r) => r.tripId === tripId);
  const ledger = state.ledger.filter((e) => e.tripId === tripId);
  const balances = computeNetBalances(ledger, trip.playerIds);
  const standings = members.map((m) => ({ playerId: m.id, displayName: m.name, roundsCounted: 0, totalGross: 0, totalNet: 0, grossToPar: 0, netToPar: 0, moneyCents: balances[m.id] ?? 0 }));
  const recaps = rounds.map((r) => {
    const snap = roundSnapshot(state, r.id);
    if (r.status === "LOCKED" && r.countsTowardTrip) {
      for (const p of snap.players) {
        const row = standings.find((s) => s.playerId === p.playerId);
        if (!row) continue;
        const t = snap.totals[p.playerId].total;
        row.roundsCounted++; row.totalGross += t.gross; row.totalNet += t.net; row.grossToPar += t.grossToPar; row.netToPar += t.netToPar;
      }
    }
    const top = snap.leaderboardNet[0];
    return { round: r, course: snap.course, holesComplete: snap.holesComplete, leader: top && top.holesPlayed > 0 ? top.displayName : null };
  });
  standings.sort((a, b) => {
    if (a.roundsCounted === 0 && b.roundsCounted === 0) return a.displayName.localeCompare(b.displayName);
    if (a.roundsCounted === 0) return 1;
    if (b.roundsCounted === 0) return -1;
    return a.netToPar - b.netToPar || a.grossToPar - b.grossToPar;
  });
  return { trip, members, rounds, recaps, standings, ledger, balances, obligations: computePairwiseObligations(ledger), settlement: optimizeSettlement(balances), liveRound: rounds.find((r) => r.status === "LIVE") ?? null };
}

/* ---------- shot tracking ---------- */
export function holeShots(round: Round, playerId: string, holeNumber: number): Shot[] {
  return (round.shots ?? []).filter((s) => s.playerId === playerId && s.holeNumber === holeNumber).sort((a, b) => a.seq - b.seq);
}
/** "I'm here": the ball came to rest at `to`; the previous rest point (or the tee) is where the shot started. */
export function logShot(state: State, roundId: string, playerId: string, holeNumber: number, to: Pt, opts: { club?: Shot["club"]; holed?: boolean; plan?: Shot["plan"] } = {}): Shot {
  const round = state.rounds.find((r) => r.id === roundId)!;
  round.shots ??= [];
  const prior = holeShots(round, playerId, holeNumber);
  const from = prior.length ? prior[prior.length - 1].to : { u: 0, v: 0 };
  const key = aimKey(roundId, playerId, holeNumber);
  const aim = state.pendingAims?.[key] ?? null;
  const shot: Shot = { id: uid(), ...shotFrom(from, to, playerId, holeNumber, prior.length + 1, round.shots, aim) };
  shot.lie = autoLie(state, round, holeNumber, to);
  if (opts.club) shot.club = opts.club;
  if (opts.holed) shot.holed = true;
  if (opts.plan) shot.plan = opts.plan;
  round.shots.push(shot);
  if (state.pendingAims) delete state.pendingAims[key];
  resyncTrackedScore(state, roundId, playerId, holeNumber);
  return shot;
}
const aimKey = (roundId: string, playerId: string, holeNumber: number) => `${roundId}:${playerId}:${holeNumber}`;
function holeShape(state: State, round: Round, holeNumber: number) {
  return holeShapeFor(state, round.courseId, holeNumber);
}
/** The hole's shape: the real outlines when a course has been loaded, otherwise the generated layout. */
export function holeShapeFor(state: State, courseId: string, holeNumber: number): HoleShape {
  const h = state.courses.find((c) => c.id === courseId)!.holes.find((x) => x.holeNumber === holeNumber)!;
  const real = state.courseGeometry?.[courseId]?.holes[holeNumber];
  return real ? buildRealHole(real, h.par) : buildHole(h.holeNumber, h.par, h.yardage);
}
export function setCourseGeometry(state: State, courseId: string, course: RealCourse | null) {
  state.courseGeometry ??= {};
  if (course) state.courseGeometry[courseId] = course; else delete state.courseGeometry[courseId];
}
/** Lie read off the hole geometry; water counts as a rough lie plus the penalty the player adds. */
function autoLie(state: State, round: Round, holeNumber: number, p: Pt): Lie {
  const l = lieAt(holeShape(state, round, holeNumber), p);
  return l === "water" ? "rough" : l;
}
/** One-tap tracking: "I'm at my ball". GPS supplies the spot on the course; here the ball is placed
 *  down the line toward the aim (or the flag) at the club's distance, or at the pin if the club reaches. */
export function markBall(state: State, roundId: string, playerId: string, holeNumber: number, club: Shot["club"], plan: Shot["plan"] = null): Shot {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const prior = holeShots(round, playerId, holeNumber);
  const from = prior.length ? prior[prior.length - 1].to : { u: 0, v: 0 };
  const flag = holeShape(state, round, holeNumber).green.c;
  const target = state.pendingAims?.[aimKey(roundId, playerId, holeNumber)] ?? flag;
  const remaining = dist(from, target);
  const seed = prior.length * 31 + holeNumber * 7 + playerId.length;
  let to: Pt;
  if (club === "putt" || club === "chip") {
    const carry = club === "putt" ? remaining : Math.min(remaining, 20);
    const len = remaining || 1;
    to = { u: from.u + ((target.u - from.u) / len) * carry, v: from.v + ((target.v - from.v) / len) * carry };
  } else {
    // Demo stand-in for GPS: one draw from the player's own dispersion model for that club.
    const player = state.players.find((p) => p.id === playerId)!;
    to = sampleShot(dispersionModel(club, player.bag ?? {}, player.handicapIndex, round.shots ?? [], playerId), from, target, seed);
  }
  return logShot(state, roundId, playerId, holeNumber, to, { club, plan });
}
/** Putts are tracked one at a time from the ball's spot: holed, or missed and left `leaveFt` from the hole. */
export function logPutt(state: State, roundId: string, playerId: string, holeNumber: number, leaveFt: number | null): Shot {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const prior = holeShots(round, playerId, holeNumber);
  const from = prior.length ? prior[prior.length - 1].to : { u: 0, v: 0 };
  const flag = holeShape(state, round, holeNumber).green.c;
  if (leaveFt === null) return logShot(state, roundId, playerId, holeNumber, flag, { club: "putt", holed: true });
  const len = dist(from, flag);
  const dir = len > 0.05 ? { u: (flag.u - from.u) / len, v: (flag.v - from.v) / len } : { u: 1, v: 0 };
  const leave = leaveFt / 3;
  // a miss usually runs past: rest the ball beyond the hole on the line
  const to = { u: flag.u + dir.u * leave, v: flag.v + dir.v * leave };
  return logShot(state, roundId, playerId, holeNumber, to, { club: "putt" });
}
/** Club whose distance best fits what's left (never longer than the player's longest club). */
export function clubForRemaining(state: State, round: Round, playerId: string, remaining: number): Club | "chip" {
  if (remaining < 30) return "chip";
  let best: Club = "Dr", bestDiff = Infinity;
  for (const c of CLUBS) { const diff = Math.abs(playerDispersion(state, round, playerId, c).carry - remaining); if (diff < bestDiff) { best = c; bestDiff = diff; } }
  return best;
}
/** Where the player intends the next shot to finish; recorded on that shot when it is logged. */
export function setPendingAim(state: State, roundId: string, playerId: string, holeNumber: number, aim: Pt | null) {
  state.pendingAims ??= {};
  const key = aimKey(roundId, playerId, holeNumber);
  if (aim) state.pendingAims[key] = aim; else delete state.pendingAims[key];
}
export function pendingAim(state: State, roundId: string, playerId: string, holeNumber: number): Pt | null {
  return state.pendingAims?.[aimKey(roundId, playerId, holeNumber)] ?? null;
}
export function updateShot(state: State, roundId: string, shotId: string, patch: Partial<Pick<Shot, "club" | "shape" | "trajectory" | "lie">>) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const shot = (round.shots ?? []).find((s) => s.id === shotId);
  if (shot) Object.assign(shot, patch);
}
/** Rest points are the truth: after any edit, each shot starts where the previous one ended. */
function rechain(round: Round, playerId: string, holeNumber: number) {
  const list = holeShots(round, playerId, holeNumber);
  let from: Pt = { u: 0, v: 0 };
  list.forEach((sh, i) => {
    const distance = Math.hypot(sh.to.u - from.u, sh.to.v - from.v);
    // A club the player never overrode follows the new distance (e.g. shot 2 becomes shot 1 after a delete).
    const others = (round.shots ?? []).filter((x) => x.id !== sh.id);
    if (Math.abs(distance - sh.distance) > 0.5 && sh.club === suggestClub(sh.distance, others, sh.playerId)) sh.club = suggestClub(distance, others, sh.playerId);
    sh.seq = i + 1;
    sh.from = from;
    sh.distance = distance;
    from = sh.to;
  });
}
/** Add a shot by typed distance, straight at the flag from the last rest point (off-course entry). */
export function addShotByDistance(state: State, roundId: string, playerId: string, holeNumber: number, distance: number, flag: Pt): Shot {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const prior = holeShots(round, playerId, holeNumber);
  const from = prior.length ? prior[prior.length - 1].to : { u: 0, v: 0 };
  const len = Math.hypot(flag.u - from.u, flag.v - from.v) || 1;
  const to = { u: from.u + ((flag.u - from.u) / len) * distance, v: from.v + ((flag.v - from.v) / len) * distance };
  return logShot(state, roundId, playerId, holeNumber, to);
}
/** Change a shot's distance along its own direction (toward the flag if it has none); later shots keep their distances. */
export function setShotDistance(state: State, roundId: string, shotId: string, distance: number, flag: Pt) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const shot = (round.shots ?? []).find((s) => s.id === shotId);
  if (!shot) return;
  let du = shot.to.u - shot.from.u, dv = shot.to.v - shot.from.v;
  let len = Math.hypot(du, dv);
  if (len < 1) { du = flag.u - shot.from.u; dv = flag.v - shot.from.v; len = Math.hypot(du, dv) || 1; }
  moveShotRest(state, roundId, shotId, { u: shot.from.u + (du / len) * distance, v: shot.from.v + (dv / len) * distance });
}
/** Move where a shot came to rest (drag on the hole view); later shots keep their own distances. */
export function moveShotRest(state: State, roundId: string, shotId: string, to: Pt) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const shot = (round.shots ?? []).find((s) => s.id === shotId);
  if (!shot) return;
  const distance = Math.hypot(to.u - shot.from.u, to.v - shot.from.v);
  // If the player never overrode the suggested club, re-suggest for the new distance.
  const others = (round.shots ?? []).filter((x) => x.id !== shot.id);
  if (shot.club === suggestClub(shot.distance, others, shot.playerId)) shot.club = suggestClub(distance, others, shot.playerId);
  if (shot.lie === null || shot.lie === autoLie(state, round, shot.holeNumber, shot.to)) shot.lie = autoLie(state, round, shot.holeNumber, to);
  // Later shots keep their own distances: shift their rest points by the same amount.
  const delta = { u: to.u - shot.to.u, v: to.v - shot.to.v };
  for (const later of holeShots(round, shot.playerId, shot.holeNumber)) {
    if (later.seq > shot.seq) later.to = { u: later.to.u + delta.u, v: later.to.v + delta.v };
  }
  shot.to = to;
  rechain(round, shot.playerId, shot.holeNumber);
}
/** Restore a player's shots on a hole from a snapshot (undo/redo). */
export function replaceHoleShots(state: State, roundId: string, playerId: string, holeNumber: number, shots: Shot[]) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  round.shots = (round.shots ?? []).filter((s) => !(s.playerId === playerId && s.holeNumber === holeNumber));
  round.shots.push(...shots.map((sh) => ({ ...sh, from: { ...sh.from }, to: { ...sh.to }, aim: sh.aim ? { ...sh.aim } : sh.aim })));
  rechain(round, playerId, holeNumber);
  resyncTrackedScore(state, roundId, playerId, holeNumber);
}
export function deleteShot(state: State, roundId: string, shotId: string) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const shot = (round.shots ?? []).find((s) => s.id === shotId);
  if (!shot) return;
  round.shots = (round.shots ?? []).filter((s) => s.id !== shotId);
  rechain(round, shot.playerId, shot.holeNumber);
  resyncTrackedScore(state, roundId, shot.playerId, shot.holeNumber);
}
export function undoShot(state: State, roundId: string, playerId: string, holeNumber: number) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const prior = holeShots(round, playerId, holeNumber);
  const last = prior[prior.length - 1];
  if (last) round.shots = (round.shots ?? []).filter((s) => s.id !== last.id);
}
/** Holed out: putts entered, score derived from shots + putts + penalties on the hole entry. */
/** After shots change on a hole that is already holed out, keep the gross = shots + putts + penalties. */
function resyncTrackedScore(state: State, roundId: string, playerId: string, holeNumber: number) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const existing = findScore(round, playerId, holeNumber);
  const all = holeShots(round, playerId, holeNumber);
  const putts = all.filter(isPutt);
  const strokes = all.length - putts.length;
  const pen = existing.entry.penaltyStrokes;
  if (all.length === 0 && !(existing.version > 0 && existing.entry.putts !== null)) return;
  const patch: Partial<HoleEntry> = {};
  if (putts.length > 0) {
    // Tracked putts own the putt count; the hole is scored once the last putt dropped.
    const holed = all[all.length - 1]?.holed === true;
    Object.assign(patch, holed ? { grossScore: strokes + putts.length + pen, putts: putts.length } : { grossScore: null, putts: null });
  } else if (existing.version > 0 && existing.entry.putts !== null) {
    patch.grossScore = strokes + existing.entry.putts + pen;
  }
  // Fairway and GIR read straight off the shots: no more tapping L / hit / R.
  const par = state.courses.find((c) => c.id === round.courseId)!.holes.find((h) => h.holeNumber === holeNumber)!.par;
  const tee = all[0];
  if (tee && !isPutt(tee) && par >= 4) patch.fairwayResult = tee.lie === "fairway" ? "HIT" : tee.to.v > 0 ? "RIGHT" : "LEFT";
  if (tee) {
    const onGreenAt = all.findIndex((sh) => !isPutt(sh) && sh.lie === "green"); // index = strokes before it
    if (onGreenAt >= 0) patch.gir = onGreenAt + 1 + pen <= par - 2;
    else patch.gir = strokes + pen >= par - 2 ? false : null; // still possible until the regulation strokes are used
  }
  const changed = (Object.keys(patch) as (keyof HoleEntry)[]).some((k) => patch[k] !== existing.entry[k]);
  if (!changed) return;
  saveScore(state, roundId, playerId, holeNumber, patch, existing.version);
}
export function holeOut(state: State, roundId: string, playerId: string, holeNumber: number, putts: number): SaveResult {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const strokes = holeShots(round, playerId, holeNumber).filter((s) => !isPutt(s)).length;
  const existing = findScore(round, playerId, holeNumber);
  const gross = strokes + putts + existing.entry.penaltyStrokes;
  return saveScore(state, roundId, playerId, holeNumber, { grossScore: gross, putts }, existing.version);
}
export type { Club, Shape, Trajectory, Lie };
