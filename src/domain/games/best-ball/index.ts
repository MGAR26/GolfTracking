import { z } from "zod";
import type { GameContext, GameDefinition, GameSettlement, HoleContext, LiveGameSummary } from "../types";
import { holeScoreFor, splitCents } from "../types";
import { formatToPar } from "../../scoring/roundTotals";

/** Team best score per hole, summed. Teams come from the game context. */
export const bestBallRulesSchema = z.object({
  basis: z.enum(["GROSS", "NET"]).default("NET"),
  /** Each player on a losing team pays this to the winning team (split across its players). */
  stakeCents: z.number().int().min(0).default(0),
});
export type BestBallRules = z.infer<typeof bestBallRulesSchema>;
export type BestBallRulesInput = z.input<typeof bestBallRulesSchema>;

export interface BestBallState {
  rules: BestBallRules;
  ctx: GameContext;
  holesPlayed: number;
  parPlayed: number;
  teamTotals: Record<string, number>;
}

export const bestBallGame: GameDefinition<BestBallRulesInput, BestBallState> = {
  type: "BEST_BALL",
  displayName: "Best Ball",
  rulesSchema: bestBallRulesSchema,
  validateRules(rules) {
    const r = bestBallRulesSchema.safeParse(rules);
    return r.success ? { ok: true, errors: [] } : { ok: false, errors: r.error.issues.map((i) => i.message) };
  },
  initialize(ctx, rules) {
    if (ctx.teams.length < 2) throw new Error("Best ball needs at least two teams");
    const teamTotals: Record<string, number> = {};
    for (const t of ctx.teams) teamTotals[t.teamId] = 0;
    return { rules: bestBallRulesSchema.parse(rules), ctx, holesPlayed: 0, parPlayed: 0, teamTotals };
  },
  onHoleFinalized(hole: HoleContext, state) {
    const teamTotals = { ...state.teamTotals };
    for (const t of state.ctx.teams) {
      const scores = t.playerIds.map((p) => holeScoreFor(state.ctx, hole, p, state.rules.basis));
      if (scores.some((s) => s === null)) return state;
      teamTotals[t.teamId] += Math.min(...(scores as number[]));
    }
    return { ...state, teamTotals, holesPlayed: state.holesPlayed + 1, parPlayed: state.parPlayed + hole.hole.par };
  },
  getLiveSummary(state): LiveGameSummary {
    const rows = state.ctx.teams
      .map((t) => ({ team: t, total: state.teamTotals[t.teamId] }))
      .sort((a, b) => a.total - b.total);
    const lead = rows[0];
    const tied = rows.filter((r) => r.total === lead.total);
    return {
      headline:
        state.holesPlayed === 0
          ? "No holes finalized yet"
          : tied.length > 1
            ? `Tied at ${formatToPar(lead.total - state.parPlayed)} thru ${state.holesPlayed}`
            : `${lead.team.name} leads by ${rows[1].total - lead.total} thru ${state.holesPlayed}`,
      lines: rows.map((r) => ({ label: r.team.name, value: `${r.total} (${formatToPar(r.total - state.parPlayed)})`, teamId: r.team.teamId })),
    };
  },
  finalize(round, state): GameSettlement[] {
    if (!round.isComplete || state.rules.stakeCents <= 0) return [];
    const rows = state.ctx.teams.map((t) => ({ team: t, total: state.teamTotals[t.teamId] })).sort((a, b) => a.total - b.total);
    const best = rows[0].total;
    const winners = rows.filter((r) => r.total === best).flatMap((r) => r.team.playerIds);
    const losers = rows.filter((r) => r.total !== best).flatMap((r) => r.team.playerIds);
    const out: GameSettlement[] = [];
    for (const loser of losers) {
      const shares = splitCents(state.rules.stakeCents, winners.length);
      winners.forEach((w, i) => {
        if (shares[i] > 0) out.push({ fromPlayerId: loser, toPlayerId: w, amountCents: shares[i], memo: "Best ball" });
      });
    }
    return out;
  },
};
