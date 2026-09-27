import { z } from "zod";
import type { GameContext, GameDefinition, GameSettlement, HoleContext, LiveGameSummary } from "../types";
import { holeScoreFor, playerName, relativeStrokeContext } from "../types";
import { applyHole, initialMatch, outcomeFromScores, sideBestScore, type MatchState } from "./core";

export const matchPlayRulesSchema = z.object({
  basis: z.enum(["GROSS", "NET"]).default("NET"),
  /** RELATIVE: lowest handicap plays off zero (match-play standard). FULL: every player takes all their strokes. */
  handicapMode: z.enum(["RELATIVE", "FULL"]).default("RELATIVE"),
  /** Paid by the losing side to the winning side. 0 = bragging rights only. */
  amountCents: z.number().int().min(0).default(0),
  /** Player ids per side. Sides may have 1+ players (best ball). */
  sideA: z.array(z.string()).min(1),
  sideB: z.array(z.string()).min(1),
});
export type MatchPlayRules = z.infer<typeof matchPlayRulesSchema>;
export type MatchPlayRulesInput = z.input<typeof matchPlayRulesSchema>;

export interface MatchPlayState {
  rules: MatchPlayRules;
  ctx: GameContext;
  match: MatchState;
}

export const matchPlayGame: GameDefinition<MatchPlayRulesInput, MatchPlayState> = {
  type: "MATCH_PLAY",
  displayName: "Match Play",
  rulesSchema: matchPlayRulesSchema,
  validateRules(rules) {
    const r = matchPlayRulesSchema.safeParse(rules);
    if (!r.success) return { ok: false, errors: r.error.issues.map((i) => i.message) };
    const overlap = r.data.sideA.filter((p) => r.data.sideB.includes(p));
    if (overlap.length) return { ok: false, errors: ["A player cannot be on both sides"] };
    return { ok: true, errors: [] };
  },
  initialize(ctx, rules) {
    const parsed = matchPlayRulesSchema.parse(rules);
    return { rules: parsed, ctx: parsed.handicapMode === "RELATIVE" ? relativeStrokeContext(ctx) : ctx, match: initialMatch(ctx.holes.length) };
  },
  onHoleFinalized(hole: HoleContext, state) {
    const a = sideBestScore(state.rules.sideA.map((p) => holeScoreFor(state.ctx, hole, p, state.rules.basis)));
    const b = sideBestScore(state.rules.sideB.map((p) => holeScoreFor(state.ctx, hole, p, state.rules.basis)));
    const outcome = outcomeFromScores(a, b);
    if (!outcome) return state;
    return { ...state, match: applyHole(state.match, hole.hole.holeNumber, outcome) };
  },
  getLiveSummary(state): LiveGameSummary {
    const nameA = state.rules.sideA.map((p) => playerName(state.ctx, p)).join(" & ");
    const nameB = state.rules.sideB.map((p) => playerName(state.ctx, p)).join(" & ");
    const m = state.match;
    let headline: string;
    if (m.closed) {
      headline = m.winner === null ? "Match halved" : `${m.winner === "A" ? nameA : nameB} wins ${m.status}`;
    } else if (m.diff === 0) {
      headline = `All square thru ${m.holesPlayed}`;
    } else {
      headline = `${m.diff > 0 ? nameA : nameB} ${m.status} thru ${m.holesPlayed}${m.dormie ? " (dormie)" : ""}`;
    }
    return {
      headline,
      lines: [
        { label: nameA, value: m.diff > 0 ? m.status : m.diff < 0 ? `${Math.abs(m.diff)} DN` : "AS", emphasis: m.diff > 0 ? "positive" : m.diff < 0 ? "negative" : "neutral" },
        { label: nameB, value: m.diff < 0 ? m.status : m.diff > 0 ? `${Math.abs(m.diff)} DN` : "AS", emphasis: m.diff < 0 ? "positive" : m.diff > 0 ? "negative" : "neutral" },
      ],
      nowNote: m.dormie ? `${m.diff > 0 ? nameA : nameB} is dormie` : undefined,
    };
  },
  finalize(_round, state): GameSettlement[] {
    return settleMatch(state.match, state.rules.sideA, state.rules.sideB, state.rules.amountCents, "Match play");
  },
};

/** Losing side players each pay the amount, split evenly across winning side players. */
export function settleMatch(
  match: MatchState,
  sideA: string[],
  sideB: string[],
  amountCents: number,
  memo: string,
): GameSettlement[] {
  if (!match.winner || amountCents <= 0) return [];
  const winners = match.winner === "A" ? sideA : sideB;
  const losers = match.winner === "A" ? sideB : sideA;
  const out: GameSettlement[] = [];
  for (const loser of losers) {
    const per = Math.floor(amountCents / winners.length);
    const rem = amountCents - per * winners.length;
    winners.forEach((w, i) => {
      const amt = per + (i < rem ? 1 : 0);
      if (amt > 0) out.push({ fromPlayerId: loser, toPlayerId: w, amountCents: amt, memo: `${memo} (${match.status})` });
    });
  }
  return out;
}
