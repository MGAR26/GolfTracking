import { z } from "zod";
import type { GameContext, GameDefinition, GameSettlement, HoleContext, LiveGameSummary } from "../types";
import { holeScoreFor, playerName, splitCents } from "../types";
import { formatToPar } from "../../scoring/roundTotals";

export const strokePlayRulesSchema = z.object({
  basis: z.enum(["GROSS", "NET"]).default("NET"),
  /** Each non-winner pays this to the winner(s). 0 = no money. */
  stakeCents: z.number().int().min(0).default(0),
});
export type StrokePlayRules = z.infer<typeof strokePlayRulesSchema>;
export type StrokePlayRulesInput = z.input<typeof strokePlayRulesSchema>;

export interface StrokePlayState {
  rules: StrokePlayRules;
  ctx: GameContext;
  holesPlayed: number;
  parPlayed: number;
  totals: Record<string, { gross: number; net: number }>;
}

export const strokePlayGame: GameDefinition<StrokePlayRulesInput, StrokePlayState> = {
  type: "STROKE_PLAY",
  displayName: "Stroke Play",
  rulesSchema: strokePlayRulesSchema,
  validateRules(rules) {
    const r = strokePlayRulesSchema.safeParse(rules);
    return r.success ? { ok: true, errors: [] } : { ok: false, errors: r.error.issues.map((i) => i.message) };
  },
  initialize(ctx, rules) {
    const totals: StrokePlayState["totals"] = {};
    for (const p of ctx.players) totals[p.playerId] = { gross: 0, net: 0 };
    return { rules: strokePlayRulesSchema.parse(rules), ctx, holesPlayed: 0, parPlayed: 0, totals };
  },
  onHoleFinalized(hole: HoleContext, state) {
    const totals = { ...state.totals };
    for (const p of state.ctx.players) {
      const gross = holeScoreFor(state.ctx, hole, p.playerId, "GROSS");
      const net = holeScoreFor(state.ctx, hole, p.playerId, "NET");
      if (gross === null || net === null) return state;
      totals[p.playerId] = { gross: totals[p.playerId].gross + gross, net: totals[p.playerId].net + net };
    }
    return { ...state, totals, holesPlayed: state.holesPlayed + 1, parPlayed: state.parPlayed + hole.hole.par };
  },
  getLiveSummary(state): LiveGameSummary {
    const rows = rankPlayers(state);
    const leader = rows[0];
    const headline =
      state.holesPlayed === 0
        ? "No holes finalized yet"
        : `${rows.filter((r) => r.score === leader.score).map((r) => playerName(state.ctx, r.playerId)).join(", ")} lead${rows.filter((r) => r.score === leader.score).length > 1 ? "" : "s"} at ${formatToPar(leader.score - state.parPlayed)} thru ${state.holesPlayed}`;
    return {
      headline,
      lines: rows.map((r) => ({
        label: playerName(state.ctx, r.playerId),
        value: `${r.score} (${formatToPar(r.score - state.parPlayed)})`,
        playerId: r.playerId,
      })),
    };
  },
  finalize(round, state): GameSettlement[] {
    if (!round.isComplete || state.rules.stakeCents <= 0) return [];
    const rows = rankPlayers(state);
    const best = rows[0].score;
    const winners = rows.filter((r) => r.score === best).map((r) => r.playerId);
    const losers = rows.filter((r) => r.score !== best).map((r) => r.playerId);
    const out: GameSettlement[] = [];
    for (const loser of losers) {
      const shares = splitCents(state.rules.stakeCents, winners.length);
      winners.forEach((w, i) => {
        if (shares[i] > 0)
          out.push({ fromPlayerId: loser, toPlayerId: w, amountCents: shares[i], memo: `Low ${state.rules.basis.toLowerCase()} stroke play` });
      });
    }
    return out;
  },
};

function rankPlayers(state: StrokePlayState) {
  const key = state.rules.basis === "GROSS" ? "gross" : "net";
  return Object.entries(state.totals)
    .map(([playerId, t]) => ({ playerId, score: t[key] }))
    .sort((a, b) => a.score - b.score || playerName(state.ctx, a.playerId).localeCompare(playerName(state.ctx, b.playerId)));
}
