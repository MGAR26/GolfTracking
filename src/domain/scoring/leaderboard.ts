import type { PlayerId, ScoringBasis } from "../types";
import type { PlayerRoundTotals } from "./roundTotals";

export interface LeaderboardRow {
  position: number;
  tied: boolean;
  playerId: PlayerId;
  displayName: string;
  holesPlayed: number;
  gross: number;
  net: number;
  grossToPar: number;
  netToPar: number;
  /** The value the board is sorted by */
  sortToPar: number;
}

/**
 * Sort by score-to-par on the chosen basis, using "thru" as a fair comparison
 * (to-par accounts for holes played). Ties share a position.
 */
export function buildLeaderboard(
  players: { playerId: PlayerId; displayName: string; totals: PlayerRoundTotals }[],
  basis: ScoringBasis,
): LeaderboardRow[] {
  const rows = players.map((p) => {
    const t = p.totals.total;
    const sortToPar = basis === "NET" ? t.netToPar : t.grossToPar;
    return {
      position: 0,
      tied: false,
      playerId: p.playerId,
      displayName: p.displayName,
      holesPlayed: t.holesPlayed,
      gross: t.gross,
      net: t.net,
      grossToPar: t.grossToPar,
      netToPar: t.netToPar,
      sortToPar,
    };
  });
  rows.sort((a, b) => {
    if (a.holesPlayed === 0 && b.holesPlayed === 0) return a.displayName.localeCompare(b.displayName);
    if (a.holesPlayed === 0) return 1;
    if (b.holesPlayed === 0) return -1;
    if (a.sortToPar !== b.sortToPar) return a.sortToPar - b.sortToPar;
    if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
    return a.displayName.localeCompare(b.displayName);
  });
  let pos = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (!prev || prev.sortToPar !== r.sortToPar || prev.holesPlayed !== r.holesPlayed || r.holesPlayed === 0) pos = i + 1;
    r.position = pos;
  });
  rows.forEach((r) => {
    r.tied = rows.filter((o) => o.position === r.position).length > 1;
  });
  return rows;
}
