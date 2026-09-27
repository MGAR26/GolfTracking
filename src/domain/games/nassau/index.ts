import { z } from "zod";
import type { GameContext, GameDefinition, GameSettlement, HoleContext, LiveGameSummary } from "../types";
import { holeScoreFor, playerName, relativeStrokeContext } from "../types";
import { settleMatch } from "../match-play";
import { applyHole, initialMatch, outcomeFromScores, sideBestScore, type MatchState } from "../match-play/core";

export const nassauRulesSchema = z.object({
  basis: z.enum(["GROSS", "NET"]).default("NET"),
  /** RELATIVE: lowest handicap plays off zero (match-play standard). FULL: every player takes all their strokes. */
  handicapMode: z.enum(["RELATIVE", "FULL"]).default("RELATIVE"),
  /** Amount for each of front / back / overall. */
  amountCents: z.number().int().min(0).default(2000),
  sideA: z.array(z.string()).min(1),
  sideB: z.array(z.string()).min(1),
  // Presses: Phase 2+. Rules key reserved so stored rules stay forward-compatible.
  presses: z.literal(false).default(false),
});
export type NassauRules = z.infer<typeof nassauRulesSchema>;
export type NassauRulesInput = z.input<typeof nassauRulesSchema>;

export interface NassauState {
  rules: NassauRules;
  ctx: GameContext;
  front: MatchState;
  back: MatchState;
  overall: MatchState;
  frontHoles: number[];
}

export const nassauGame: GameDefinition<NassauRulesInput, NassauState> = {
  type: "NASSAU",
  displayName: "Nassau",
  rulesSchema: nassauRulesSchema,
  validateRules(rules) {
    const r = nassauRulesSchema.safeParse(rules);
    if (!r.success) return { ok: false, errors: r.error.issues.map((i) => i.message) };
    if (r.data.sideA.some((p) => r.data.sideB.includes(p))) return { ok: false, errors: ["A player cannot be on both sides"] };
    return { ok: true, errors: [] };
  },
  initialize(ctx, rules) {
    const sorted = [...ctx.holes].sort((a, b) => a.holeNumber - b.holeNumber);
    const half = Math.ceil(sorted.length / 2);
    const parsed = nassauRulesSchema.parse(rules);
    return {
      rules: parsed,
      ctx: parsed.handicapMode === "RELATIVE" ? relativeStrokeContext(ctx) : ctx,
      front: initialMatch(half),
      back: initialMatch(sorted.length - half),
      overall: initialMatch(sorted.length),
      frontHoles: sorted.slice(0, half).map((h) => h.holeNumber),
    };
  },
  onHoleFinalized(hole: HoleContext, state) {
    const a = sideBestScore(state.rules.sideA.map((p) => holeScoreFor(state.ctx, hole, p, state.rules.basis)));
    const b = sideBestScore(state.rules.sideB.map((p) => holeScoreFor(state.ctx, hole, p, state.rules.basis)));
    const outcome = outcomeFromScores(a, b);
    if (!outcome) return state;
    const n = hole.hole.holeNumber;
    const isFront = state.frontHoles.includes(n);
    return {
      ...state,
      front: isFront ? applyHole(state.front, n, outcome) : state.front,
      back: isFront ? state.back : applyHole(state.back, n, outcome),
      overall: applyHole(state.overall, n, outcome),
    };
  },
  getLiveSummary(state): LiveGameSummary {
    const nameA = state.rules.sideA.map((p) => playerName(state.ctx, p)).join(" & ");
    const nameB = state.rules.sideB.map((p) => playerName(state.ctx, p)).join(" & ");
    const seg = (label: string, m: MatchState) => {
      const leader = m.diff > 0 ? nameA : m.diff < 0 ? nameB : null;
      const value = m.closed
        ? m.winner
          ? `${leader} ${m.status}`
          : "Halved"
        : m.holesPlayed === 0
          ? "Not started"
          : leader
            ? `${leader} ${m.status}${m.dormie ? " (dormie)" : ""}`
            : `AS thru ${m.holesPlayed}`;
      return { label, value, emphasis: (m.diff > 0 ? "positive" : m.diff < 0 ? "negative" : "neutral") as "positive" | "negative" | "neutral" };
    };
    const lines = [seg("Front 9", state.front), seg("Back 9", state.back), seg("Overall", state.overall)];
    const live = [state.front, state.back, state.overall].filter((m) => !m.closed && m.holesPlayed > 0);
    return {
      headline: `${nameA} vs ${nameB}`,
      lines,
      nowNote: live.some((m) => m.dormie) ? "A Nassau segment is dormie" : undefined,
    };
  },
  finalize(_round, state): GameSettlement[] {
    const { sideA, sideB, amountCents } = state.rules;
    return [
      ...settleMatch(state.front, sideA, sideB, amountCents, "Nassau front 9"),
      ...settleMatch(state.back, sideA, sideB, amountCents, "Nassau back 9"),
      ...settleMatch(state.overall, sideA, sideB, amountCents, "Nassau overall"),
    ];
  },
};
