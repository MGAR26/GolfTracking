import type { ReactNode } from "react";
import type { LeaderboardRow } from "../src/domain/scoring";
import type { Snapshot, ProjectedGame } from "./store";
import { money } from "../src/lib/format";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-lg px-4 pb-28 pt-4 flex flex-col gap-4 ${className}`}>{children}</main>;
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`card p-4 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between mb-3">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "gold" | "red" }) {
  const cls = { neutral: "bg-surface-2 text-ink-2", green: "bg-tint text-ink", gold: "bg-brass-soft text-brass", red: "bg-neg-soft text-neg" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function ToPar({ value, className = "" }: { value: number; className?: string }) {
  const text = value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`;
  const tone = value < 0 ? "text-neg" : value === 0 ? "text-ink" : "text-ink";
  return <span className={`${tone} ${className}`}>{text}</span>;
}

export function Button({ children, onClick, variant = "primary", className = "", disabled, type = "button" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; className?: string; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`}>
      {children}
    </button>
  );
}

export function TextLink({ children, onClick, className = "" }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={`text-sm font-semibold text-accent ${className}`}>
      {children}
    </button>
  );
}

export function StrokeDots({ n }: { n: number }) {
  if (n === 0) return null;
  const abs = Math.min(Math.abs(n), 3);
  return (
    <span className="inline-flex gap-0.5 align-middle ml-1">
      {Array.from({ length: abs }).map((_, i) => (
        <span key={i} className={`inline-block h-1.5 w-1.5 rounded-full ${n > 0 ? "bg-accent" : "bg-neg"}`} />
      ))}
    </span>
  );
}

export function Leaderboard({ rows, basis, highlightId }: { rows: LeaderboardRow[]; basis: "NET" | "GROSS"; highlightId?: string | null }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-muted">
        <tr>
          <th className="text-left font-semibold py-1 w-8">Pos</th>
          <th className="text-left font-semibold py-1">Player</th>
          <th className="text-right font-semibold py-1 w-12">Thru</th>
          <th className="text-right font-semibold py-1 w-14">Gross</th>
          <th className="text-right font-semibold py-1 w-14">{basis === "NET" ? "Net" : "Gross"}</th>
          <th className="text-right font-semibold py-1 w-12">To par</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.playerId} className={`border-t border-line ${r.playerId === highlightId ? "bg-tint/50" : ""}`}>
            <td className="py-2 font-semibold text-ink-2">{r.holesPlayed === 0 ? "–" : `${r.tied ? "T" : ""}${r.position}`}</td>
            <td className="py-2 font-medium">{r.displayName}</td>
            <td className="py-2 text-right text-ink-2">{r.holesPlayed === 0 ? "–" : r.holesPlayed === 18 ? "F" : r.holesPlayed}</td>
            <td className="py-2 text-right">{r.holesPlayed ? r.gross : "–"}</td>
            <td className="py-2 text-right font-semibold">{r.holesPlayed ? (basis === "NET" ? r.net : r.gross) : "–"}</td>
            <td className="py-2 text-right font-semibold">{r.holesPlayed ? <ToPar value={basis === "NET" ? r.netToPar : r.grossToPar} /> : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function scoreClass(toPar: number | null): string {
  if (toPar === null) return "";
  if (toPar <= -2) return "score-double-circle";
  if (toPar === -1) return "score-circle";
  if (toPar === 1) return "score-square";
  if (toPar >= 2) return "score-double-square";
  return "";
}

function Nine({ snap, holes, label, onCell }: { snap: Snapshot; holes: Snapshot["holes"]; label: string; onCell: ((playerId: string, hole: number) => void) | null }) {
  const segKey = label === "OUT" ? "out" : "in";
  return (
    <table className="text-sm border-collapse min-w-full">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-muted">
          <th className="sticky-col text-left font-semibold pr-2 py-1 w-24">Hole</th>
          {holes.map((h) => <th key={h.holeNumber} className="font-semibold w-9 py-1 text-center">{h.holeNumber}</th>)}
          <th className="font-semibold w-11 py-1 text-center">{label}</th>
        </tr>
        <tr className="text-xs text-ink-2">
          <th className="sticky-col text-left font-medium pr-2 py-0.5">Par</th>
          {holes.map((h) => <th key={h.holeNumber} className="font-medium text-center py-0.5">{h.par}</th>)}
          <th className="font-semibold text-center py-0.5">{holes.reduce((a, h) => a + h.par, 0)}</th>
        </tr>
        <tr className="text-[10px] text-muted">
          <th className="sticky-col text-left font-medium pr-2 py-0.5">Yds</th>
          {holes.map((h) => <th key={h.holeNumber} className="font-normal text-center py-0.5">{h.yardage ?? "–"}</th>)}
          <th className="font-normal text-center py-0.5">{holes.every((h) => h.yardage) ? holes.reduce((a, h) => a + (h.yardage ?? 0), 0) : ""}</th>
        </tr>
        <tr className="text-[10px] text-muted">
          <th className="sticky-col text-left font-medium pr-2 py-0.5">SI</th>
          {holes.map((h) => <th key={h.holeNumber} className="font-normal text-center py-0.5">{h.strokeIndex}</th>)}
          <th />
        </tr>
      </thead>
      <tbody>
        {snap.players.map((p) => {
          const t = snap.totals[p.playerId];
          return (
            <tr key={p.playerId} className="border-t border-line">
              <td className="sticky-col pr-2 py-1.5 font-medium whitespace-nowrap">
                {p.displayName}
                <span className="block text-[10px] text-muted font-normal">CH {p.courseHandicap}</span>
              </td>
              {holes.map((h) => {
                const line = t.holes.find((l) => l.holeNumber === h.holeNumber)!;
                const cell = (
                  <span className="relative inline-flex flex-col items-center justify-center w-8 h-9">
                    <span className={`inline-flex items-center justify-center w-7 h-7 font-semibold ${scoreClass(line.grossToPar)}`}>{line.gross ?? ""}</span>
                    {line.net !== null && line.strokesReceived !== 0 && <span className="text-[9px] leading-none text-ink -mt-0.5">{line.net}</span>}
                    {line.strokesReceived > 0 && (
                      <span className="absolute top-0 right-0 flex gap-px">
                        {Array.from({ length: Math.min(line.strokesReceived, 2) }).map((_, i) => <span key={i} className="block h-1 w-1 rounded-full bg-accent" />)}
                      </span>
                    )}
                  </span>
                );
                return (
                  <td key={h.holeNumber} className="text-center p-0">
                    {onCell ? <button type="button" className="inline-flex" onClick={() => onCell(p.playerId, h.holeNumber)}>{cell}</button> : cell}
                  </td>
                );
              })}
              <td className="text-center font-semibold py-1.5">
                {t[segKey].holesPlayed ? t[segKey].gross : ""}
                {t[segKey].holesPlayed ? <span className="block text-[10px] text-ink">{t[segKey].net}</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Scorecard({ snap, onCell }: { snap: Snapshot; onCell: ((playerId: string, hole: number) => void) | null }) {
  const front = snap.holes.slice(0, 9);
  const back = snap.holes.slice(9);
  return (
    <div className="flex flex-col gap-3">
      <div className="card p-2 scroll-x"><Nine snap={snap} holes={front} label="OUT" onCell={onCell} /></div>
      {back.length > 0 && <div className="card p-2 scroll-x"><Nine snap={snap} holes={back} label="IN" onCell={onCell} /></div>}
      <div className="card p-3">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr><th className="text-left font-semibold">Total</th><th className="text-right font-semibold">Gross</th><th className="text-right font-semibold">Strokes</th><th className="text-right font-semibold">Net</th></tr>
          </thead>
          <tbody>
            {snap.players.map((p) => {
              const t = snap.totals[p.playerId];
              return (
                <tr key={p.playerId} className="border-t border-line">
                  <td className="py-1.5 font-medium">{p.displayName}</td>
                  <td className="py-1.5 text-right font-semibold">{t.holesPlayed ? t.total.gross : "–"}</td>
                  <td className="py-1.5 text-right text-ink-2">{t.strokesReceived}</td>
                  <td className="py-1.5 text-right font-semibold text-ink">{t.holesPlayed ? t.total.net : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted">Dots mark handicap strokes received. Circles are under par, squares over par. Tap any score to edit.</p>
      </div>
    </div>
  );
}

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
            {rules.basis ? ` · ${rules.basis.toLowerCase()}` : ""}{stake ? ` · ${money(stake)}` : ""}{game.holesFinalized.length ? ` · thru ${game.holesFinalized.length}` : ""}
          </p>
        </div>
        <Pill tone={game.status === "FINALIZED" ? "green" : "neutral"}>{game.status === "FINALIZED" ? "Final" : "Live"}</Pill>
      </div>
      <p className="font-medium text-ink mb-2">{game.summary.headline}</p>
      <ul className="divide-y divide-line">
        {game.summary.lines.map((l, i) => (
          <li key={i} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-ink-2">{l.label}</span>
            <span className={`font-semibold ${l.emphasis === "positive" ? "text-ink" : l.emphasis === "negative" ? "text-neg" : ""}`}>{l.value}</span>
          </li>
        ))}
      </ul>
      {game.settlements.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold text-accent cursor-pointer">Settlement ({game.settlements.length})</summary>
          <ul className="mt-1 text-xs text-ink-2 space-y-0.5">
            {game.settlements.map((st, i) => (
              <li key={i}>{playerNames[st.fromPlayerId]} → {playerNames[st.toPlayerId]} {money(st.amountCents)} <span className="text-muted">· {st.memo}</span></li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
