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
import type { Pt } from "./holeGeometry";
import { shotFrom, type Club, type Shape, type Shot, type Trajectory, type Lie } from "./shots";

export interface Player { id: string; name: string; handicapIndex: number; favoriteYardages?: number[] }
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
}
export interface State { players: Player[]; trips: Trip[]; courses: Course[]; rounds: Round[]; ledger: LedgerEntry[]; actorId: string; audit: { at: string; actorId: string; action: string; detail: string }[]; wind?: { mph: number; fromDeg: number } }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

export const SEED_HOLES: HoleInfo[] = [
  [1, 4, 401, 7], [2, 5, 532, 3], [3, 3, 178, 15], [4, 4, 438, 1], [5, 4, 392, 11], [6, 3, 165, 17], [7, 4, 412, 5], [8, 5, 548, 9], [9, 4, 385, 13],
  [10, 4, 421, 4], [11, 3, 190, 16], [12, 5, 560, 2], [13, 4, 377, 12], [14, 4, 445, 6], [15, 5, 515, 10], [16, 3, 152, 18], [17, 4, 408, 8], [18, 4, 430, 14],
].map(([holeNumber, par, yardage, strokeIndex]) => ({ holeNumber, par, yardage, strokeIndex }));

export function seedState(): State {
  const players: Player[] = [
    { id: "p_matt", name: "Matt", handicapIndex: 5.2 },
    { id: "p_marcus", name: "Marcus", handicapIndex: 11.4 },
    { id: "p_ryan", name: "Ryan", handicapIndex: 8.7 },
    { id: "p_john", name: "John", handicapIndex: 14.1 },
  ];
  const course: Course = { id: "c_pinehurst4", name: "Pinehurst No. 4", teeName: "Blue", par: 72, courseRating: 72.4, slopeRating: 135, holes: SEED_HOLES };
  const trip: Trip = { id: "t_pinehurst", name: "Pinehurst Trip 2026", destination: "Pinehurst, NC", startDate: "2026-10-09", endDate: "2026-10-11", ownerId: "p_matt", playerIds: players.map((p) => p.id) };
  const state: State = { players, trips: [trip], courses: [course], rounds: [], ledger: [], actorId: "p_matt", audit: [] };
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
  const seedScores: Record<string, [number, number | null, boolean | null, HoleEntry["fairwayResult"]][]> = {
    p_matt: [[4, 2, true, "HIT"], [5, 2, true, "HIT"], [3, 1, true, null]],
    p_marcus: [[5, 2, false, "LEFT"], [6, 3, false, "HIT"], [4, 2, false, null]],
    p_ryan: [[4, 1, false, "RIGHT"], [5, 2, true, "HIT"], [3, 2, true, null]],
    p_john: [[6, 2, false, "LEFT"], [7, 3, false, "RIGHT"], [4, 2, false, null]],
  };
  for (const [pid, arr] of Object.entries(seedScores)) {
    arr.forEach(([grossScore, putts, gir, fairwayResult], i) => {
      round.scores.push({ entry: { ...emptyHoleEntry(pid, i + 1), grossScore, putts, gir, fairwayResult }, version: 1, updatedBy: "p_matt" });
    });
  }
  createSideBet(state, { roundId: round.id, type: "LONGEST_DRIVE_IN_FAIRWAY", description: "Longest Drive in Fairway - Hole 8", amountCents: 2000, basis: "GROSS", holeNumbers: [8], opponentIds: ["p_marcus"] }, "p_matt");
  return state;
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

/* ---------- projections ---------- */
export interface ProjectedGame { id: string; type: string; name: string; rules: Record<string, unknown>; status: string; teams: GameContext["teams"]; summary: LiveGameSummary; settlements: GameSettlement[]; holesFinalized: number[] }
export interface ProjectedSideBet extends StoredSideBet { autoResult: "A" | "B" | "TIE" | null }
export interface Snapshot {
  round: Round; course: Course; holes: HoleInfo[];
  players: (RoundPlayerInfo & { playingHandicap: number; tripRole: TripRole | null })[];
  entries: HoleEntry[]; totals: Record<string, PlayerRoundTotals>; leaderboardNet: LeaderboardRow[]; leaderboardGross: LeaderboardRow[];
  stats: Record<string, RoundStats>; games: ProjectedGame[]; sideBets: ProjectedSideBet[]; currentHole: number | null; holesComplete: number; nowNotes: string[];
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
    return { id: g.id, type: g.type, name: g.name, rules: g.rules, status: g.status, teams: g.teams, summary: run.summary, settlements: run.settlements, holesFinalized: run.holesFinalized };
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
  return { round, course, holes, players, entries, totals, leaderboardNet: buildLeaderboard(lb, "NET"), leaderboardGross: buildLeaderboard(lb, "GROSS"), stats, games, sideBets, currentHole, holesComplete, nowNotes };
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
export function logShot(state: State, roundId: string, playerId: string, holeNumber: number, to: Pt): Shot {
  const round = state.rounds.find((r) => r.id === roundId)!;
  round.shots ??= [];
  const prior = holeShots(round, playerId, holeNumber);
  const from = prior.length ? prior[prior.length - 1].to : { u: 0, v: 0 };
  const shot: Shot = { id: uid(), ...shotFrom(from, to, playerId, holeNumber, prior.length + 1, round.shots) };
  round.shots.push(shot);
  return shot;
}
export function updateShot(state: State, roundId: string, shotId: string, patch: Partial<Pick<Shot, "club" | "shape" | "trajectory" | "lie">>) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const shot = (round.shots ?? []).find((s) => s.id === shotId);
  if (shot) Object.assign(shot, patch);
}
export function undoShot(state: State, roundId: string, playerId: string, holeNumber: number) {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const prior = holeShots(round, playerId, holeNumber);
  const last = prior[prior.length - 1];
  if (last) round.shots = (round.shots ?? []).filter((s) => s.id !== last.id);
}
/** Holed out: putts entered, score derived from shots + putts + penalties on the hole entry. */
export function holeOut(state: State, roundId: string, playerId: string, holeNumber: number, putts: number): SaveResult {
  const round = state.rounds.find((r) => r.id === roundId)!;
  const shots = holeShots(round, playerId, holeNumber);
  const existing = findScore(round, playerId, holeNumber);
  const gross = shots.length + putts + existing.entry.penaltyStrokes;
  return saveScore(state, roundId, playerId, holeNumber, { grossScore: gross, putts }, existing.version);
}
export type { Club, Shape, Trajectory, Lie };
