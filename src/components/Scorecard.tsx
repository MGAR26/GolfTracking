import Link from "next/link";
import type { RoundSnapshot } from "@/server/services/roundProjection";

function scoreClass(toPar: number | null): string {
  if (toPar === null) return "";
  if (toPar <= -2) return "score-double-circle";
  if (toPar === -1) return "score-circle";
  if (toPar === 1) return "score-square";
  if (toPar >= 2) return "score-double-square";
  return "";
}

function Nine({ snap, holes, label, editable, showNet }: { snap: RoundSnapshot; holes: RoundSnapshot["holes"]; label: string; editable: boolean; showNet: boolean }) {
  const segKey = label === "OUT" ? "out" : "in";
  return (
    <table className="text-sm border-collapse min-w-full">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-muted">
          <th className="sticky-col text-left font-semibold pr-2 py-1 w-24">Hole</th>
          {holes.map((h) => (
            <th key={h.holeNumber} className="font-semibold w-9 py-1 text-center">{h.holeNumber}</th>
          ))}
          <th className="font-semibold w-11 py-1 text-center">{label}</th>
        </tr>
        <tr className="text-xs text-ink-2">
          <th className="sticky-col text-left font-medium pr-2 py-0.5">Par</th>
          {holes.map((h) => (
            <th key={h.holeNumber} className="font-medium text-center py-0.5">{h.par}</th>
          ))}
          <th className="font-semibold text-center py-0.5">{holes.reduce((a, h) => a + h.par, 0)}</th>
        </tr>
        <tr className="text-[10px] text-muted">
          <th className="sticky-col text-left font-medium pr-2 py-0.5">Yds</th>
          {holes.map((h) => (
            <th key={h.holeNumber} className="font-normal text-center py-0.5">{h.yardage ?? "–"}</th>
          ))}
          <th className="font-normal text-center py-0.5">{holes.every((h) => h.yardage) ? holes.reduce((a, h) => a + (h.yardage ?? 0), 0) : ""}</th>
        </tr>
        <tr className="text-[10px] text-muted">
          <th className="sticky-col text-left font-medium pr-2 py-0.5">SI</th>
          {holes.map((h) => (
            <th key={h.holeNumber} className="font-normal text-center py-0.5">{h.strokeIndex}</th>
          ))}
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
                    {showNet && line.net !== null && line.strokesReceived !== 0 && <span className="text-[9px] leading-none text-green-ink -mt-0.5">{line.net}</span>}
                    {line.strokesReceived > 0 && (
                      <span className="absolute top-0 right-0 flex gap-px">
                        {Array.from({ length: Math.min(line.strokesReceived, 2) }).map((_, i) => (
                          <span key={i} className="block h-1 w-1 rounded-full bg-green" />
                        ))}
                      </span>
                    )}
                  </span>
                );
                return (
                  <td key={h.holeNumber} className="text-center p-0">
                    {editable ? (
                      <Link href={`/rounds/${snap.round.id}/score?hole=${h.holeNumber}&player=${p.playerId}`} className="inline-flex" aria-label={`Edit ${p.displayName} hole ${h.holeNumber}`}>
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )}
                  </td>
                );
              })}
              <td className="text-center font-semibold py-1.5">
                {t[segKey].holesPlayed ? t[segKey].gross : ""}
                {showNet && t[segKey].holesPlayed ? <span className="block text-[10px] text-green-ink">{t[segKey].net}</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Scorecard({ snap, showNet = true }: { snap: RoundSnapshot; showNet?: boolean }) {
  const front = snap.holes.slice(0, 9);
  const back = snap.holes.slice(9);
  const editable = snap.round.status === "LIVE";
  return (
    <div className="flex flex-col gap-3">
      <div className="card p-2 scroll-x">
        <Nine snap={snap} holes={front} label="OUT" editable={editable} showNet={showNet} />
      </div>
      {back.length > 0 && (
        <div className="card p-2 scroll-x">
          <Nine snap={snap} holes={back} label="IN" editable={editable} showNet={showNet} />
        </div>
      )}
      <div className="card p-3">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="text-left font-semibold">Total</th>
              <th className="text-right font-semibold">Gross</th>
              <th className="text-right font-semibold">Strokes</th>
              <th className="text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody>
            {snap.players.map((p) => {
              const t = snap.totals[p.playerId];
              return (
                <tr key={p.playerId} className="border-t border-line">
                  <td className="py-1.5 font-medium">{p.displayName}</td>
                  <td className="py-1.5 text-right font-semibold">{t.holesPlayed ? t.total.gross : "–"}</td>
                  <td className="py-1.5 text-right text-ink-2">{t.strokesReceived}</td>
                  <td className="py-1.5 text-right font-semibold text-green-ink">{t.holesPlayed ? t.total.net : "–"}</td>
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
