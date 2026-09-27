import { z } from "zod";
import type { GameContext, GameDefinition, GameSettlement, HoleContext, LiveGameSummary } from "../types";
import { holeScoreFor, playerName } from "../types";

export const skinsRulesSchema = z.object({
  basis: z.enum(["GROSS", "NET"]).default("NET"),
  /** Value of one skin, paid by EACH other player to the winner. */
  skinValueCents: z.number().int().min(0).default(500),
  carryover: z.boolean().default(true),
  /** If true, unclaimed carryover at the end of the round is void (default). */
  voidUnclaimed: z.boolean().default(true),
});
export type SkinsRules = z.infer<typeof skinsRulesSchema>;
export type SkinsRulesInput = z.input<typeof skinsRulesSchema>;

export interface SkinResult {
  holeNumber: number;
  winnerPlayerId: string | null;
  /** Number of skins awarded on this hole (1 + carried). */
  skins: number;
  lowScore: number;
  tiedPlayerIds: string[];
}

export interface SkinsState {
  rules: SkinsRules;
  ctx: GameContext;
  results: SkinResult[];
  carried: number;
  skinsByPlayer: Record<string, number>;
}

export const skinsGame: GameDefinition<SkinsRulesInput, SkinsState> = {
  type: "SKINS",
  displayName: "Skins",
  rulesSchema: skinsRulesSchema,
  validateRules(rules) {
    const r = skinsRulesSchema.safeParse(rules);
    return r.success ? { ok: true, errors: [] } : { ok: false, errors: r.error.issues.map((i) => i.message) };
  },
  initialize(ctx, rules) {
    const skinsByPlayer: Record<string, number> = {};
    for (const p of ctx.players) skinsByPlayer[p.playerId] = 0;
    return { rules: skinsRulesSchema.parse(rules), ctx, results: [], carried: 0, skinsByPlayer };
  },
  onHoleFinalized(hole: HoleContext, state) {
    const scores = state.ctx.players.map((p) => ({
      playerId: p.playerId,
      score: holeScoreFor(state.ctx, hole, p.playerId, state.rules.basis),
    }));
    if (scores.some((s) => s.score === null)) return state;
    const low = Math.min(...scores.map((s) => s.score as number));
    const lowPlayers = scores.filter((s) => s.score === low).map((s) => s.playerId);
    const available = 1 + (state.rules.carryover ? state.carried : 0);
    if (lowPlayers.length === 1) {
      const winner = lowPlayers[0];
      return {
        ...state,
        carried: 0,
        results: [...state.results, { holeNumber: hole.hole.holeNumber, winnerPlayerId: winner, skins: available, lowScore: low, tiedPlayerIds: [] }],
        skinsByPlayer: { ...state.skinsByPlayer, [winner]: state.skinsByPlayer[winner] + available },
      };
    }
    return {
      ...state,
      carried: state.rules.carryover ? state.carried + 1 : 0,
      results: [...state.results, { holeNumber: hole.hole.holeNumber, winnerPlayerId: null, skins: 0, lowScore: low, tiedPlayerIds: lowPlayers }],
    };
  },
  getLiveSummary(state): LiveGameSummary {
    const others = state.ctx.players.length - 1;
    const perSkin = state.rules.skinValueCents * others;
    const rows = Object.entries(state.skinsByPlayer).sort((a, b) => b[1] - a[1]);
    const carrying = state.rules.carryover && state.carried > 0;
    const nextValue = (1 + state.carried) * perSkin;
    return {
      headline: carrying
        ? `${state.carried} skin${state.carried > 1 ? "s" : ""} carrying: next hole worth $${(nextValue / 100).toFixed(0)}`
        : state.results.length === 0
          ? "No skins decided yet"
          : `${rows[0][1]} skin${rows[0][1] === 1 ? "" : "s"} to ${playerName(state.ctx, rows[0][0])}`,
      lines: rows.map(([playerId, n]) => ({
        label: playerName(state.ctx, playerId),
        value: `${n} skin${n === 1 ? "" : "s"} · $${((n * perSkin) / 100).toFixed(0)}`,
        playerId,
      })),
      nowNote: carrying ? `$${(nextValue / 100).toFixed(0)} skin is carrying` : undefined,
    };
  },
  finalize(_round, state): GameSettlement[] {
    if (state.rules.skinValueCents <= 0) return [];
    const out: GameSettlement[] = [];
    for (const r of state.results) {
      if (!r.winnerPlayerId || r.skins === 0) continue;
      const value = r.skins * state.rules.skinValueCents;
      for (const p of state.ctx.players) {
        if (p.playerId === r.winnerPlayerId) continue;
        out.push({
          fromPlayerId: p.playerId,
          toPlayerId: r.winnerPlayerId,
          amountCents: value,
          memo: `Skin${r.skins > 1 ? `s x${r.skins}` : ""} - Hole ${r.holeNumber}`,
        });
      }
    }
    return out;
  },
};
