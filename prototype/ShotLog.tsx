import { useState } from "react";
import { Card } from "./ui";
import { bagAverages, CLUBS, DEFAULT_CARRY, type Shape, type Shot, type Trajectory, type Lie } from "./shots";

const clubLabel = (c: Shot["club"]) => (c === "chip" ? "Chip" : c === "Dr" ? "Driver" : c);

export function ShotLog({ shots, tracking, onToggle, playerName, par, penalties, onUpdate, onUndo, onHoleOut, onAddDistance, onSetDistance, onDelete }: {
  shots: Shot[]; tracking: boolean; onToggle: () => void; playerName: string; par: number; penalties: number;
  onUpdate: (id: string, patch: Partial<Pick<Shot, "club" | "shape" | "trajectory" | "lie">>) => void; onUndo: () => void; onHoleOut: (putts: number) => void;
  onAddDistance: (yards: number) => void; onSetDistance: (id: string, yards: number) => void; onDelete: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const last = shots[shots.length - 1];
  // Edit the shot you tapped; otherwise the newest one.
  const editing = shots.find((s) => s.id === selectedId) ?? last;
  return (
    <Card title={`${playerName} · shot tracking`} action={<button type="button" className={`btn !min-h-8 text-xs ${tracking ? "btn-primary" : "btn-secondary"}`} onClick={onToggle} data-testid="track-toggle">{tracking ? "Tracking on" : "Track shots"}</button>} className={tracking ? "!border-brass" : ""}>
      {!tracking && shots.length === 0 && <p className="text-sm text-muted">Turn on tracking, then mark where each shot comes to rest (GPS on the course; here, type a distance or tap the hole). The score fills itself in from shots + putts + penalties.</p>}
      {shots.length > 0 && (
        <ol className="divide-y divide-line text-sm" data-testid="shot-list">
          {shots.map((sh) => (
            <li key={sh.id}>
              <button type="button" onClick={() => setSelectedId(sh.id === editing?.id && selectedId ? null : sh.id)} className={`w-full text-left py-1.5 flex items-center justify-between gap-2 rounded-md px-1 -mx-1 ${tracking && editing?.id === sh.id ? "bg-brass-soft" : ""}`} aria-label={`Edit shot ${sh.seq}`}>
                <span><span className="text-muted mr-1">{sh.seq}.</span><span className="font-semibold">{clubLabel(sh.club)}</span> <span className="text-ink-2">{Math.round(sh.distance)} yds</span>{sh.shape || sh.trajectory ? <span className="text-muted"> · {[sh.trajectory, sh.shape].filter(Boolean).join(" ")}</span> : null}{sh.lie ? <span className="text-muted"> → {sh.lie}</span> : null}</span>
                {tracking && <span className="text-[11px] font-semibold text-accent">{editing?.id === sh.id ? "editing" : "edit"}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
      {tracking && (
        <form className="mt-2 flex items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); const n = Number(typed); if (n > 0) { onAddDistance(n); setTyped(""); setSelectedId(null); } }} data-testid="add-by-distance">
          <span className="text-muted whitespace-nowrap">Add shot</span>
          <input className="field !min-h-9 w-24" inputMode="numeric" placeholder="yards" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Shot distance in yards" />
          <button type="submit" className="btn btn-secondary !min-h-9 text-xs" disabled={!(Number(typed) > 0)}>Add</button>
          <span className="text-[11px] text-muted">or tap the hole</span>
        </form>
      )}
      {tracking && editing && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-2/50 p-2" data-testid="shot-editor">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">Shot {editing.seq} · {Math.round(editing.distance)} yds</span>
            <div className="flex items-center gap-1">
              <button type="button" className="tap !min-h-8 !min-w-8 rounded-md bg-surface border border-line-strong text-sm font-bold" aria-label="5 yards shorter" onClick={() => onSetDistance(editing.id, Math.max(1, Math.round(editing.distance) - 5))}>−5</button>
              <input className="field !min-h-8 w-16 !px-2 text-center" inputMode="numeric" aria-label={`Shot ${editing.seq} distance`} value={Math.round(editing.distance)} onChange={(e) => { const n = Number(e.target.value); if (n > 0) onSetDistance(editing.id, n); }} />
              <button type="button" className="tap !min-h-8 !min-w-8 rounded-md bg-surface border border-line-strong text-sm font-bold" aria-label="5 yards longer" onClick={() => onSetDistance(editing.id, Math.round(editing.distance) + 5)}>+5</button>
              <button type="button" className="tap !min-h-8 text-xs font-semibold text-neg ml-1" onClick={() => { onDelete(editing.id); setSelectedId(null); }}>Delete</button>
            </div>
          </div>
          <div>
            <span className="label">Club <span className="normal-case font-normal text-muted">(suggested {clubLabel(editing.club)})</span></span>
            <div className="flex flex-wrap gap-1">
              {(["chip", ...CLUBS] as Shot["club"][]).map((c) => (
                <button key={c} type="button" aria-pressed={editing.club === c} onClick={() => onUpdate(editing.id, { club: c })} className={`tap !min-h-8 rounded-full px-2.5 text-xs font-semibold border ${editing.club === c ? "bg-ink text-[var(--bg)] border-ink" : "bg-surface border-line-strong"}`}>{clubLabel(c)}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="label">Shape</span><div className="seg">{(["draw", "straight", "fade"] as Shape[]).map((v) => <button key={v} type="button" aria-pressed={editing.shape === v} onClick={() => onUpdate(editing.id, { shape: editing.shape === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
            <div><span className="label">Flight</span><div className="seg">{(["low", "normal", "high"] as Trajectory[]).map((v) => <button key={v} type="button" aria-pressed={editing.trajectory === v} onClick={() => onUpdate(editing.id, { trajectory: editing.trajectory === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
          </div>
          <div><span className="label">Ended up</span><div className="seg">{(["fairway", "rough", "sand", "fringe", "green"] as Lie[]).map((v) => <button key={v} type="button" aria-pressed={editing.lie === v} onClick={() => onUpdate(editing.id, { lie: editing.lie === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
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
