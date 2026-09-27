import type { HoleEntry, HoleInfo, PlayerId, RoundPlayerInfo, ScoringBasis } from "../types";
import { allocateStrokes, totalAllocated } from "../handicap/strokeAllocation";

export interface GameTeamInfo {
  teamId: string;
  name: string;
  playerIds: PlayerId[];
}

/** Everything a game needs about the round it lives in. Stable for the life of the round. */
export interface GameContext {
  gameId: string;
  holes: HoleInfo[];
  players: RoundPlayerInfo[];
  /** Per-game team configuration (teams belong to the game, not the round). */
  teams: GameTeamInfo[];
}

/** One finalized hole: entries for every participant on that hole. */
export interface HoleContext {
  hole: HoleInfo;
  /** Entries for this hole only; a participant with no gross score is absent. */
  entries: HoleEntry[];
}

export interface RoundContext {
  holesCompleted: number[];
  isComplete: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** A money outcome. Positive amounts only; direction is from -> to. */
export interface GameSettlement {
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  amountCents: number;
  memo: string;
}

export interface LiveSummaryLine {
  label: string;
  value: string;
  playerId?: PlayerId;
  teamId?: string;
  emphasis?: "positive" | "negative" | "neutral";
}

export interface LiveGameSummary {
  headline: string;
  lines: LiveSummaryLine[];
  /** Optional one-liner for the "what matters now" card. */
  nowNote?: string;
}

export interface GameDefinition<TRules, TState> {
  type: string;
  displayName: string;
  rulesSchema: unknown;
  validateRules(rules: TRules): ValidationResult;
  initialize(ctx: GameContext, rules: TRules): TState;
  onHoleFinalized(ctx: HoleContext, state: TState): TState;
  getLiveSummary(state: TState): LiveGameSummary;
  finalize(ctx: RoundContext, state: TState): GameSettlement[];
}

export interface RunGameResult<TState> {
  state: TState;
  summary: LiveGameSummary;
  settlements: GameSettlement[];
  holesFinalized: number[];
}

/**
 * Feed a game every hole (in order) where all its participants have a gross score.
 * Deterministic: re-running from raw entries always yields the same state, which is
 * what lets a single score edit recompute every dependent result.
 */
export function runGame<TRules, TState>(
  def: GameDefinition<TRules, TState>,
  ctx: GameContext,
  rules: TRules,
  entries: HoleEntry[],
): RunGameResult<TState> {
  const validation = def.validateRules(rules);
  if (!validation.ok) throw new Error(`Invalid ${def.type} rules: ${validation.errors.join("; ")}`);
  let state = def.initialize(ctx, rules);
  const participantIds = new Set(ctx.players.map((p) => p.playerId));
  const holesFinalized: number[] = [];
  const sortedHoles = [...ctx.holes].sort((a, b) => a.holeNumber - b.holeNumber);
  for (const hole of sortedHoles) {
    const holeEntries = entries.filter(
      (e) => e.holeNumber === hole.holeNumber && participantIds.has(e.playerId) && e.grossScore !== null,
    );
    if (holeEntries.length !== participantIds.size) break; // stop at the first incomplete hole
    state = def.onHoleFinalized({ hole, entries: holeEntries }, state);
    holesFinalized.push(hole.holeNumber);
  }
  const roundCtx: RoundContext = {
    holesCompleted: holesFinalized,
    isComplete: holesFinalized.length === sortedHoles.length,
  };
  return {
    state,
    summary: def.getLiveSummary(state),
    settlements: roundCtx.isComplete ? def.finalize(roundCtx, state) : [],
    holesFinalized,
  };
}

/** Helper: score for a player on this hole using the chosen basis. */
export function holeScoreFor(
  ctx: GameContext,
  hole: HoleContext,
  playerId: PlayerId,
  basis: ScoringBasis,
): number | null {
  const entry = hole.entries.find((e) => e.playerId === playerId);
  if (!entry || entry.grossScore === null) return null;
  if (basis === "GROSS") return entry.grossScore;
  const player = ctx.players.find((p) => p.playerId === playerId);
  const strokes = player?.allocation[hole.hole.holeNumber] ?? 0;
  return entry.grossScore - strokes;
}

/**
 * Split a total evenly among winners; remainder cents go to the first winners so the
 * ledger stays in integer cents and sums exactly.
 */
export function splitCents(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

export function playerName(ctx: GameContext, playerId: PlayerId): string {
  return ctx.players.find((p) => p.playerId === playerId)?.displayName ?? playerId;
}

/**
 * Head-to-head handicapping: the lowest-handicap participant plays off zero and everyone
 * else receives the difference, allocated by stroke index. Used by Match Play and Nassau.
 */
export function relativeStrokeContext(ctx: GameContext): GameContext {
  if (ctx.players.length === 0) return ctx;
  const strokes = ctx.players.map((p) => totalAllocated(p.allocation));
  const min = Math.min(...strokes);
  return {
    ...ctx,
    players: ctx.players.map((p, i) => ({ ...p, allocation: allocateStrokes(strokes[i] - min, ctx.holes) })),
  };
}
