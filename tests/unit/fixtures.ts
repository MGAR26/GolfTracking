import type { HoleEntry, HoleInfo, RoundPlayerInfo } from "@/domain/types";
import { emptyHoleEntry } from "@/domain/types";
import { allocateStrokes } from "@/domain/handicap";
import type { GameContext } from "@/domain/games";

const PARS = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4]; // 72
const SI = [7, 3, 15, 1, 11, 17, 5, 13, 9, 8, 16, 2, 12, 4, 10, 18, 6, 14];

export function course18(): HoleInfo[] {
  return PARS.map((par, i) => ({ holeNumber: i + 1, par, yardage: 400, strokeIndex: SI[i] }));
}

export function player(id: string, name: string, courseHandicap: number, holes = course18()): RoundPlayerInfo {
  return { playerId: id, displayName: name, handicapIndex: courseHandicap, courseHandicap, allocation: allocateStrokes(courseHandicap, holes) };
}

export function ctx(players: RoundPlayerInfo[], teams: GameContext["teams"] = []): GameContext {
  return { gameId: "g1", holes: course18(), players, teams };
}

/** Build full-round entries from an array of 18 gross scores per player. */
export function entriesFor(scores: Record<string, number[]>): HoleEntry[] {
  const out: HoleEntry[] = [];
  for (const [pid, arr] of Object.entries(scores)) {
    arr.forEach((s, i) => out.push({ ...emptyHoleEntry(pid, i + 1), grossScore: s }));
  }
  return out;
}

export const PAR_ROUND = PARS;
