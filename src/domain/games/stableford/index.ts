import { z } from "zod";
import type { GameContext, GameDefinition, GameSettlement, HoleContext, LiveGameSummary } from "../types";
import { holeScoreFor, playerName, splitCents } from "../types";

/** Points keyed by score relative to par; scores outside the table clamp to the nearest edge. */
export const stablefordRulesSchema = z.object({
  basis: z.enum(["GROSS", "NET"]).default("NET"),
  pointsTable: z
    .record(z.string(), z.number().int())
    .default({ "-3": 5, "-2": 4, "-1": 3, "0": 2, "1": 1, "2": 0 }),
  stakeCents: z.number().int().min(0).default(0),
});
export type StablefordRules = z.infer<typeof stablefordRulesSchema>;
export type StablefordRulesInput = z.input<typeof stablefordRulesSchema>;

export interface StablefordState {
  rules: StablefordRules;
  ctx: GameContext;
  holesPlayed: number;
  points: Record<string, number>;
}

export function stablefordPoints(table: Record<string, number>, toPar: number): number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return 0;
  const clamped = Math.max(keys[0], Math.min(keys[keys.length - 1], toPar));
  return table[String(clamped)] ?? 0;
}

export const stablefordGame: GameDefinition<StablefordRulesInput, StablefordState> = {
  type: "STABLEFORD",
  displayName: "Stableford",
  rulesSchema: stablefordRulesSchema,
  validateRules(rules) {
    const r = stablefordRulesSchema.safeParse(rules);
    return r.success ? { ok: true, errors: [] } : { ok: false, errors: r.error.issues.map((i) => i.message) };
  },
  initialize(ctx, rules) {
    const points: Record<string, number> = {};
    for (const p of ctx.players) points[p.playerId] = 0;
    return { rules: stablefordRulesSchema.parse(rules), ctx, holesPlayed: 0, points };
  },
  onHoleFinalized(hole: HoleContext, state) {
    const points = { ...state.points };
    for (const p of state.ctx.players) {
      const s = holeScoreFor(state.ctx, hole, p.playerId, state.rules.basis);
      if (s === null) return state;
      points[p.playerId] += stablefordPoints(state.rules.pointsTable, s - hole.hole.par);
    }
    return { ...state, points, holesPlayed: state.holesPlayed + 1 };
  },
  getLiveSummary(state): LiveGameSummary {
    const rows = Object.entries(state.points).sort((a, b) => b[1] - a[1]);
    return {
      headline: state.holesPlayed === 0 ? "No holes finalized yet" : `${playerName(state.ctx, rows[0][0])} leads with ${rows[0][1]} pts thru ${state.holesPlayed}`,
      lines: rows.map(([playerId, pts]) => ({ label: playerName(state.ctx, playerId), value: `${pts} pts`, playerId })),
    };
  },
  finalize(round, state): GameSettlement[] {
    if (!round.isComplete || state.rules.stakeCents <= 0) return [];
    const rows = Object.entries(state.points).sort((a, b) => b[1] - a[1]);
    const best = rows[0][1];
    const winners = rows.filter((r) => r[1] === best).map((r) => r[0]);
    const losers = rows.filter((r) => r[1] !== best).map((r) => r[0]);
    const out: GameSettlement[] = [];
    for (const loser of losers) {
      const shares = splitCents(state.rules.stakeCents, winners.length);
      winners.forEach((w, i) => {
        if (shares[i] > 0) out.push({ fromPlayerId: loser, toPlayerId: w, amountCents: shares[i], memo: "Stableford" });
      });
    }
    return out;
  },
};
