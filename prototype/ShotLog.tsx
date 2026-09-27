import { Card } from "./ui";
import { bagAverages, CLUBS, DEFAULT_CARRY, type Shape, type Shot, type Trajectory, type Lie } from "./shots";

const clubLabel = (c: Shot["club"]) => (c === "chip" ? "Chip" : c === "Dr" ? "Driver" : c);

export function ShotLog({ shots, tracking, onToggle, playerName, par, penalties, onUpdate, onUndo, onHoleOut }: {
  shots: Shot[]; tracking: boolean; onToggle: () => void; playerName: string; par: number; penalties: number;
  onUpdate: (id: string, patch: Partial<Pick<Shot, "club" | "shape" | "trajectory" | "lie">>) => void; onUndo: () => void; onHoleOut: (putts: number) => void;
}) {
  const last = shots[shots.length - 1];
  return (
    <Card title={`${playerName} · shot tracking`} action={<button type="button" className={`btn !min-h-8 text-xs ${tracking ? "btn-primary" : "btn-secondary"}`} onClick={onToggle} data-testid="track-toggle">{tracking ? "Tracking on" : "Track shots"}</button>} className={tracking ? "!border-brass" : ""}>
      {!tracking && shots.length === 0 && <p className="text-sm text-muted">Turn on tracking, then tap the hole where each shot comes to rest. The score fills itself in from shots + putts + penalties.</p>}
      {shots.length > 0 && (
        <ol className="divide-y divide-line text-sm" data-testid="shot-list">
          {shots.map((sh) => (
            <li key={sh.id} className="py-1.5 flex items-center justify-between gap-2">
              <span><span className="text-muted mr-1">{sh.seq}.</span><span className="font-semibold">{clubLabel(sh.club)}</span> <span className="text-ink-2">{Math.round(sh.distance)} yds</span>{sh.shape || sh.trajectory ? <span className="text-muted"> · {[sh.trajectory, sh.shape].filter(Boolean).join(" ")}</span> : null}{sh.lie ? <span className="text-muted"> → {sh.lie}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
      {tracking && last && (
        <div className="mt-2 flex flex-col gap-2" data-testid="last-shot-editor">
          <div>
            <span className="label">Shot {last.seq}: what did you hit? <span className="normal-case font-normal text-muted">(suggested {clubLabel(last.club)})</span></span>
            <div className="flex flex-wrap gap-1">
              {(["chip", ...CLUBS] as Shot["club"][]).map((c) => (
                <button key={c} type="button" aria-pressed={last.club === c} onClick={() => onUpdate(last.id, { club: c })} className={`tap !min-h-8 rounded-full px-2.5 text-xs font-semibold border ${last.club === c ? "bg-ink text-[var(--bg)] border-ink" : "bg-surface border-line-strong"}`}>{clubLabel(c)}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="label">Shape</span><div className="seg">{(["draw", "straight", "fade"] as Shape[]).map((v) => <button key={v} type="button" aria-pressed={last.shape === v} onClick={() => onUpdate(last.id, { shape: last.shape === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
            <div><span className="label">Flight</span><div className="seg">{(["low", "normal", "high"] as Trajectory[]).map((v) => <button key={v} type="button" aria-pressed={last.trajectory === v} onClick={() => onUpdate(last.id, { trajectory: last.trajectory === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
          </div>
          <div><span className="label">Ended up</span><div className="seg">{(["fairway", "rough", "sand", "fringe", "green"] as Lie[]).map((v) => <button key={v} type="button" aria-pressed={last.lie === v} onClick={() => onUpdate(last.id, { lie: last.lie === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
        </div>
      )}
      {tracking && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Holed out · putts</span>
            <div className="seg">{[0, 1, 2, 3].map((n) => <button key={n} type="button" onClick={() => onHoleOut(n)} className="!min-h-9 !px-3" aria-label={`Holed out in ${n} putts`}>{n === 3 ? "3+" : n}</button>)}</div>
          </div>
          {shots.length > 0 && <button type="button" className="text-xs font-semibold text-accent" onClick={onUndo}>Undo last</button>}
        </div>
      )}
      {tracking && <p className="mt-2 text-[11px] text-muted">Score will be {shots.length} shot{shots.length === 1 ? "" : "s"} + putts{penalties ? ` + ${penalties} penalty` : ""} (par {par}).</p>}
    </Card>
  );
}

export function BagCard({ shots, playerId, playerName }: { shots: Shot[]; playerId: string; playerName: string }) {
  const bag = bagAverages(shots, playerId);
  const logged = CLUBS.filter((c) => bag[c]);
  return (
    <Card title={`${playerName} · my bag`} action={<span className="text-xs text-muted">{logged.length ? "from tracked shots" : "defaults until you track"}</span>}>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {CLUBS.map((c) => {
          const b = bag[c];
          return (
            <div key={c} className={`rounded-lg py-1.5 ${b ? "bg-brass-soft" : "bg-surface-2/60"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted">{clubLabel(c)}</p>
              <p className="font-display text-lg leading-tight">{Math.round(b?.avg ?? DEFAULT_CARRY[c])}</p>
              {b && <p className="text-[9px] text-ink-2">{b.n} shot{b.n === 1 ? "" : "s"}</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">Median of your logged distances per club. Gold tiles are measured; grey are typical numbers until you have data. These feed the club suggestions and your lay-up numbers.</p>
    </Card>
  );
}
