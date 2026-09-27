import type { LeaderboardRow } from "@/domain/scoring";
import { ToPar } from "./ui";

export function Leaderboard({ rows, basis, compact = false, highlightId }: { rows: LeaderboardRow[]; basis: "NET" | "GROSS"; compact?: boolean; highlightId?: string | null }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="text-left font-semibold py-1 w-8">Pos</th>
          <th className="text-left font-semibold py-1">Player</th>
          <th className="text-right font-semibold py-1 w-12">Thru</th>
          {!compact && <th className="text-right font-semibold py-1 w-14">Gross</th>}
          <th className="text-right font-semibold py-1 w-14">{basis === "NET" ? "Net" : "Gross"}</th>
          <th className="text-right font-semibold py-1 w-12">To par</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.playerId} className={`border-t border-line ${r.playerId === highlightId ? "bg-green-soft/50" : ""}`}>
            <td className="py-2 font-semibold text-ink-2">{r.holesPlayed === 0 ? "–" : `${r.tied ? "T" : ""}${r.position}`}</td>
            <td className="py-2 font-medium">{r.displayName}</td>
            <td className="py-2 text-right text-ink-2">{r.holesPlayed === 0 ? "–" : r.holesPlayed === 18 ? "F" : r.holesPlayed}</td>
            {!compact && <td className="py-2 text-right">{r.holesPlayed ? r.gross : "–"}</td>}
            <td className="py-2 text-right font-semibold">{r.holesPlayed ? (basis === "NET" ? r.net : r.gross) : "–"}</td>
            <td className="py-2 text-right font-semibold">{r.holesPlayed ? <ToPar value={basis === "NET" ? r.netToPar : r.grossToPar} /> : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
