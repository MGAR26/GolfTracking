import type { ProjectedGame } from "@/server/services/roundProjection";
import { Card, Pill } from "./ui";
import { money } from "@/lib/format";

export function GameCard({ game, playerNames }: { game: ProjectedGame; playerNames: Record<string, string> }) {
  const rules = game.rules as { basis?: string; skinValueCents?: number; amountCents?: number; stakeCents?: number };
  const stake = rules.skinValueCents ?? rules.amountCents ?? rules.stakeCents ?? 0;
  return (
    <Card>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="font-display text-lg leading-tight">{game.name}</h3>
          <p className="text-xs text-muted">
            {game.type.replace("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
            {rules.basis ? ` · ${rules.basis.toLowerCase()}` : ""}
            {stake ? ` · ${money(stake)}` : ""}
            {game.holesFinalized.length ? ` · thru ${game.holesFinalized.length}` : ""}
          </p>
        </div>
        <Pill tone={game.status === "FINALIZED" ? "green" : "neutral"}>{game.status === "FINALIZED" ? "Final" : "Live"}</Pill>
      </div>
      <p className="font-medium text-ink mb-2">{game.summary.headline}</p>
      <ul className="divide-y divide-line">
        {game.summary.lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-ink-2">{l.label}</span>
            <span className={`font-semibold ${l.emphasis === "positive" ? "text-green-ink" : l.emphasis === "negative" ? "text-red" : ""}`}>{l.value}</span>
          </li>
        ))}
      </ul>
      {game.settlements.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold text-green cursor-pointer">Settlement ({game.settlements.length})</summary>
          <ul className="mt-1 text-xs text-ink-2 space-y-0.5">
            {game.settlements.map((st, i) => (
              <li key={i}>
                {playerNames[st.fromPlayerId]} → {playerNames[st.toPlayerId]} {money(st.amountCents)} <span className="text-muted">· {st.memo}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
