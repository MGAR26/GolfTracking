import type { GameDefinition } from "./types";
import { strokePlayGame } from "./stroke-play";
import { matchPlayGame } from "./match-play";
import { nassauGame } from "./nassau";
import { skinsGame } from "./skins";
import { stablefordGame } from "./stableford";
import { bestBallGame } from "./best-ball";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDefinition = GameDefinition<any, any>;

export const GAME_REGISTRY: Record<string, AnyGameDefinition> = {
  [strokePlayGame.type]: strokePlayGame,
  [matchPlayGame.type]: matchPlayGame,
  [nassauGame.type]: nassauGame,
  [skinsGame.type]: skinsGame,
  [stablefordGame.type]: stablefordGame,
  [bestBallGame.type]: bestBallGame,
};

export type GameType = keyof typeof GAME_REGISTRY;

export function getGameDefinition(type: string): AnyGameDefinition {
  const def = GAME_REGISTRY[type];
  if (!def) throw new Error(`Unknown game type: ${type}`);
  return def;
}
