import { useEffect, useState } from "react";
import { Card } from "./ui";
import { CLUBS, missFromAim, type Club, type Shape, type Shot, type Trajectory, type Lie } from "./shots";
import { dist, type Pt } from "./holeGeometry";
import { defaultProfile, dispersionModel, type Bag, type ClubProfile, type DispersionModel, type MissBias, type MissWidth } from "./bag";
import { describeAim, type Outcome, type Play, type Simulation, type Strategy } from "./strategy";

const clubLabel = (c: Shot["club"]) => (c === "chip" ? "Chip" : c === "putt" ? "Putt" : c === "Dr" ? "Driver" : c);

const missText = (sh: Shot) => { const m = missFromAim(sh); if (!m) return null; const lat = Math.round(Math.abs(m.lateral)), lng = Math.round(Math.abs(m.long)); return `${lat ? `${lat} ${m.lateral > 0 ? "R" : "L"}` : "on line"}${lng ? `, ${lng} ${m.long > 0 ? "long" : "short"}` : ""}`; };

export function ShotLog({ shots, tracking, onToggle, selectedId, onSelect, aim, aimMode, onAimMode, onClearAim, playerName, par, penalties, putts, gross, remaining, flag, suggested, onMark, onPutt, onClubChange, dispersion, strategy, onUpdate, onUndo, onRedo, canUndo, canRedo, onHoleOut, onAddDistance, onSetDistance, onDelete }: {
  shots: Shot[]; tracking: boolean; onToggle: () => void; selectedId: string | null; onSelect: (id: string | null) => void; aim: Pt | null; aimMode: boolean; onAimMode: () => void; onClearAim: () => void; playerName: string; par: number; penalties: number; putts: number | null; gross: number | null;
  /** Yards from the ball to the pin, and the club that fits it. */
  remaining: number; flag: Pt; suggested: Shot["club"]; onMark: (club: Shot["club"]) => void; onPutt: (leaveFt: number | null) => void; onClubChange?: (club: Shot["club"]) => void; dispersion?: DispersionModel | null;
  /** Odds for the selected club at the current aim, the ranked plays, and the risk slider. */
  strategy?: { current: Simulation | null; plan: Strategy | null; risk: number; onRisk: (r: number) => void; onPlay: (club: Club, aim: Pt) => void } | null;
  onUpdate: (id: string, patch: Partial<Pick<Shot, "club" | "shape" | "trajectory" | "lie">>) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; onHoleOut: (putts: number) => void;
  onAddDistance: (yards: number) => void; onSetDistance: (id: string, yards: number) => void; onDelete: (id: string) => void;
}) {
  const setSelectedId = onSelect;
  const [typed, setTyped] = useState("");
  const [showTyped, setShowTyped] = useState(false);
  // Club for the next shot: the suggestion unless the player picked one for this exact shot.
  const [pick, setPick] = useState<{ forShot: number; club: Shot["club"] } | null>(null);
  const club = pick?.forShot === shots.length ? pick.club : suggested;
  useEffect(() => { onClubChange?.(club); }, [club, onClubChange]);
  // Draft text for the distance field so the user can clear it and retype without it snapping back.
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const commitDraft = () => {
    if (!draft) return;
    const n = Number(draft.text);
    if (n > 0) onSetDistance(draft.id, Math.round(n));
    setDraft(null);
  };
  const last = shots[shots.length - 1];
  const holed = !!last?.holed;
  const onGreen = !holed && !!last && last.lie === "green";
  const puttShots = shots.filter((s) => s.club === "putt");
  const strokes = shots.length - puttShots.length;
  const ft = Math.round(remaining * 3);
  const editing = selectedId ? shots.find((s) => s.id === selectedId) ?? null : null;
  const seg = (v: string) => <span className="text-muted">{v}</span>;
  return (
    <Card title={`${playerName} · shot tracking`} action={<button type="button" className={`btn !min-h-8 text-xs whitespace-nowrap ${tracking ? "btn-primary" : "btn-secondary"}`} onClick={onToggle} data-testid="track-toggle">{tracking ? "Tracking on" : "Track shots"}</button>} className={tracking ? "!border-brass" : ""}>
      {!tracking && shots.length === 0 && <p className="text-sm text-muted">One tap per shot: when you reach your ball, press <b>Mark ball</b>. GPS records where it is, the club and distance fill in, and your score is shots + putts. No typing.</p>}
      {tracking && (
        <div className="flex flex-col gap-2" data-testid="track-flow">
          <p className="text-sm" data-testid="track-status">
            {holed ? <><b>Holed out</b> {seg(`· ${strokes} shot${strokes === 1 ? "" : "s"} + ${puttShots.length} putt${puttShots.length === 1 ? "" : "s"}`)}</> : onGreen ? <><b>{puttShots.length ? `Putt ${puttShots.length + 1}` : "On the green"}</b> {seg(`· ${ft} ft to the hole`)}</> : <><b>Shot {shots.length + 1}</b> {seg(`· ${Math.round(remaining)} to the pin`)}{last?.lie ? seg(` · from the ${last.lie}`) : seg(" · from the tee")}</>}
          </p>
          {!onGreen && !holed && (
            <>
              <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0.5" aria-label="Club for this shot">
                {(["chip", ...CLUBS] as Shot["club"][]).map((c) => (
                  <button key={c} type="button" aria-pressed={club === c} onClick={() => setPick({ forShot: shots.length, club: c })} className={`tap !min-h-8 shrink-0 rounded-full px-2.5 text-xs font-semibold border ${club === c ? "bg-ink text-[var(--bg)] border-ink" : c === suggested ? "bg-brass-soft border-brass" : "bg-surface border-line-strong"}`}>{clubLabel(c)}</button>
                ))}
              </div>
              <div className="flex items-stretch gap-2">
                <button type="button" className="btn btn-primary flex-1 !min-h-12 text-base" onClick={() => { onMark(club); setSelectedId(null); }} data-testid="mark-ball">
                  Mark ball <span className="font-normal opacity-80 text-sm">· {clubLabel(club)}</span>
                </button>
                <button type="button" aria-pressed={aimMode} onClick={onAimMode} className={`btn !min-h-12 text-sm whitespace-nowrap ${aimMode ? "btn-primary" : "btn-secondary"}`} data-testid="aim-toggle">{aimMode ? "Tap hole…" : aim ? "Aim ✓" : "Aim"}</button>
              </div>
              {dispersion && club !== "chip" && club !== "putt" && (
                <p className="text-[11px] text-ink-2" data-testid="dispersion-line">
                  Your {clubLabel(club)}: carries {Math.round(dispersion.carry)}{Math.abs(dispersion.center.lateral) >= 2 ? `, tends ${Math.round(Math.abs(dispersion.center.lateral))} ${dispersion.center.lateral > 0 ? "right" : "left"}` : ", straight"}, 8 in 10 inside ±{Math.round(dispersion.sdLateral * 1.8)} yds
                  <span className="text-muted"> · {dispersion.samples ? `${dispersion.samples} aimed shot${dispersion.samples === 1 ? "" : "s"}` : "from your bag profile"}</span>
                </p>
              )}
              {strategy && (strategy.current || strategy.plan) && (
                <StrategyCard current={strategy.current} plan={strategy.plan} risk={strategy.risk} onRisk={strategy.onRisk} onPlay={(c, a) => { setPick({ forShot: shots.length, club: c }); strategy.onPlay(c, a); }} />
              )}
              <p className="text-[11px] text-muted">
                On the course GPS marks the spot when you press it. In this demo it drops the ball down the line for the club;{" "}
                <button type="button" className="text-accent font-semibold" onClick={() => setShowTyped((v) => !v)}>type yards</button> or tap the picture to be exact.
                {aim && !aimMode && <> · aim set <button type="button" className="text-accent font-semibold" onClick={onClearAim}>clear</button></>}
              </p>
              {showTyped && (
                <form className="flex items-center gap-2 text-sm" onSubmit={(e) => { e.preventDefault(); const n = Number(typed); if (n > 0) { onAddDistance(n); setTyped(""); setSelectedId(null); } }} data-testid="add-by-distance">
                  <input className="field !min-h-9 w-24" inputMode="numeric" placeholder="yards" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Shot distance in yards" autoFocus />
                  <button type="submit" className="btn btn-secondary !min-h-9 text-xs" disabled={!(Number(typed) > 0)}>Add</button>
                </form>
              )}
            </>
          )}
          {onGreen && (
            <div className="flex flex-col gap-2" data-testid="putt-flow">
              <button type="button" className="btn btn-primary !min-h-12 text-base" onClick={() => onPutt(null)} data-testid="holed-it">Holed it <span className="font-normal opacity-80 text-sm">· {ft} ft putt</span></button>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted whitespace-nowrap">Missed · ft left</span>
                <div className="seg flex-1">{[1, 3, 6, 10, 20].map((n) => <button key={n} type="button" onClick={() => onPutt(n)} className="!min-h-10 !px-1" aria-label={`Missed, ${n} feet left`}>{n}</button>)}</div>
              </div>
              <p className="text-[11px] text-muted">
                First putt length comes from where the ball sits; each miss you just say what&apos;s left.
                {puttShots.length === 0 && <> Or skip the detail and enter putts: {[1, 2, 3, 4].map((n) => <button key={n} type="button" className="text-accent font-semibold px-1" onClick={() => onHoleOut(n)} aria-label={`Holed out in ${n} putts`}>{n}</button>)}</>}
                {" "}<button type="button" className="text-accent font-semibold" onClick={() => onUpdate(last.id, { lie: "fringe" })}>Not on the green?</button>
              </p>
            </div>
          )}
          {holed && <p className="text-[11px] text-muted">Wrong? Undo the last putt or remove a row below.</p>}
        </div>
      )}
      {shots.length > 0 && (
        <ol className={`divide-y divide-line text-sm ${tracking ? "mt-3 border-t border-line" : ""}`} data-testid="shot-list">
          {shots.map((sh) => (
            <li key={sh.id} className={`flex items-center gap-1 rounded-md -mx-1 ${tracking && editing?.id === sh.id ? "bg-brass-soft" : ""}`}>
              <button type="button" onClick={() => setSelectedId(sh.id === selectedId ? null : sh.id)} className="flex-1 min-w-0 text-left py-1.5 flex items-center justify-between gap-2 px-1" aria-label={`Edit shot ${sh.seq}`}>
                <span className="truncate"><span className="text-muted mr-1">{sh.seq}.</span><span className="font-semibold">{clubLabel(sh.club)}</span> <span className="text-ink-2">{sh.club === "putt" ? `${Math.round(dist(sh.from, flag) * 3)} ft` : Math.round(sh.distance)}</span>{sh.club === "putt" ? <span className="text-muted">{sh.holed ? " · holed" : ` → ${Math.round(dist(sh.to, flag) * 3)} ft left`}</span> : sh.lie ? <span className="text-muted"> → {sh.lie}</span> : null}{sh.shape || sh.trajectory ? <span className="text-muted"> · {[sh.trajectory, sh.shape].filter(Boolean).join(" ")}</span> : null}{sh.aim ? <span className="text-brass"> · {missText(sh)}</span> : null}</span>
                {tracking && <span className="text-[11px] font-semibold text-accent shrink-0">{editing?.id === sh.id ? "done" : "edit"}</span>}
              </button>
              {tracking && <button type="button" className="tap !min-h-8 !min-w-8 rounded-md text-muted hover:text-neg text-lg leading-none" aria-label={`Remove shot ${sh.seq}`} onClick={() => { onDelete(sh.id); if (selectedId === sh.id) setSelectedId(null); }}>×</button>}
            </li>
          ))}
        </ol>
      )}
      {tracking && editing && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-2/50 p-2" data-testid="shot-editor">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">Shot {editing.seq} · {Math.round(editing.distance)} yds</span>
            <div className="flex items-center gap-1">
              <button type="button" className="tap !min-h-8 !min-w-8 rounded-md bg-surface border border-line-strong text-sm font-bold" aria-label="5 yards shorter" onClick={() => onSetDistance(editing.id, Math.max(1, Math.round(editing.distance) - 5))}>−5</button>
              <input
                className="field !min-h-8 w-16 !px-2 text-center"
                inputMode="numeric"
                enterKeyHint="done"
                aria-label={`Shot ${editing.seq} distance`}
                value={draft?.id === editing.id ? draft.text : String(Math.round(editing.distance))}
                onFocus={(e) => { setDraft({ id: editing.id, text: String(Math.round(editing.distance)) }); e.target.select(); }}
                onChange={(e) => setDraft({ id: editing.id, text: e.target.value.replace(/[^0-9]/g, "") })}
                onBlur={commitDraft}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              />
              <button type="button" className="tap !min-h-8 !min-w-8 rounded-md bg-surface border border-line-strong text-sm font-bold" aria-label="5 yards longer" onClick={() => onSetDistance(editing.id, Math.round(editing.distance) + 5)}>+5</button>
              <button type="button" className="tap !min-h-8 text-xs font-semibold text-neg ml-1" onClick={() => { onDelete(editing.id); setSelectedId(null); }}>Delete</button>
            </div>
          </div>
          {editing.club !== "putt" && <div>
            <span className="label">Club</span>
            <div className="flex flex-wrap gap-1">
              {(["chip", ...CLUBS] as Shot["club"][]).map((c) => (
                <button key={c} type="button" aria-pressed={editing.club === c} onClick={() => onUpdate(editing.id, { club: c })} className={`tap !min-h-8 rounded-full px-2.5 text-xs font-semibold border ${editing.club === c ? "bg-ink text-[var(--bg)] border-ink" : "bg-surface border-line-strong"}`}>{clubLabel(c)}</button>
              ))}
            </div>
          </div>}
          <div className="grid grid-cols-2 gap-2">
            <div><span className="label">Shape</span><div className="seg">{(["draw", "straight", "fade"] as Shape[]).map((v) => <button key={v} type="button" aria-pressed={editing.shape === v} onClick={() => onUpdate(editing.id, { shape: editing.shape === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
            <div><span className="label">Flight</span><div className="seg">{(["low", "normal", "high"] as Trajectory[]).map((v) => <button key={v} type="button" aria-pressed={editing.trajectory === v} onClick={() => onUpdate(editing.id, { trajectory: editing.trajectory === v ? null : v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
          </div>
          <div><span className="label">Ended up <span className="normal-case font-normal text-muted">(read from the map; fix it if wrong)</span></span><div className="seg">{(["fairway", "rough", "sand", "fringe", "green"] as Lie[]).map((v) => <button key={v} type="button" aria-pressed={editing.lie === v} onClick={() => onUpdate(editing.id, { lie: v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
        </div>
      )}
      {tracking && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted" data-testid="derived-score">
            {putts === null
              ? `Score so far: ${strokes} shot${strokes === 1 ? "" : "s"}${puttShots.length ? ` + ${puttShots.length} putt${puttShots.length === 1 ? "" : "s"}` : ""}${penalties ? ` + ${penalties} penalty` : ""} … (par ${par}).`
              : `${strokes} shot${strokes === 1 ? "" : "s"} + ${putts} putt${putts === 1 ? "" : "s"}${penalties ? ` + ${penalties} penalty` : ""} = ${gross ?? strokes + putts + penalties} · on your card (par ${par}).`}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" className="btn btn-secondary !min-h-8 !px-2.5 text-xs" onClick={onUndo} disabled={!canUndo} aria-label="Undo">↶ Undo</button>
            <button type="button" className="btn btn-secondary !min-h-8 !px-2.5 text-xs" onClick={onRedo} disabled={!canRedo} aria-label="Redo">↷</button>
          </div>
        </div>
      )}
    </Card>
  );
}

const ODDS: { key: Outcome; label: string; color: string }[] = [
  { key: "fairway", label: "Fairway", color: "#a3c276" }, { key: "green", label: "Green", color: "#9cc873" }, { key: "rough", label: "Rough", color: "#5f7f48" }, { key: "sand", label: "Sand", color: "#cbbb84" }, { key: "water", label: "Water", color: "#6d9fc4" },
];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const playLine = (s: Simulation) => `${s.odds.green >= 0.2 ? `green ${pct(s.odds.green)}` : `fairway ${pct(s.odds.fairway)}`} · water ${pct(s.odds.water)}${s.leave >= 25 ? ` · leaves ${Math.round(s.leave)}` : ""}`;

/** Odds for this club and aim, the three plays, and the Safe ↔ Bold slider. All computed on the phone from the player's bag. */
export function StrategyCard({ current, plan, risk, onRisk, onPlay }: { current: Simulation | null; plan: Strategy | null; risk: number; onRisk: (r: number) => void; onPlay: (club: Club, aim: Pt) => void }) {
  const [open, setOpen] = useState(true);
  const picked = plan?.recommended;
  return (
    <div className="rounded-lg border border-line bg-surface p-2 flex flex-col gap-2" data-testid="strategy-card">
      <button type="button" className="flex items-center justify-between text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="label !mb-0">Odds &amp; plays</span>
        <span className="text-[11px] text-muted">{open ? "hide" : "show"}</span>
      </button>
      {open && current && (
        <div data-testid="outcome">
          <div className="flex items-baseline justify-between text-[11px] mb-1"><span className="font-semibold">{clubLabel(current.club)} · {describeAim(current.aimOffset)}</span><span className="text-muted">expected {current.expected.toFixed(1)} strokes from here</span></div>
          <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 items-center text-[11px]">
            {ODDS.filter((o) => current.odds[o.key] >= 0.005).map((o) => (
              <div key={o.key} className="contents">
                <div className="h-1.5 rounded bg-surface-2 overflow-hidden"><div className="h-full rounded" style={{ width: pct(current.odds[o.key]), background: o.color }} /></div>
                <div className="whitespace-nowrap">{o.label} <b>{pct(current.odds[o.key])}</b></div>
              </div>
            ))}
          </div>
          {current.leave >= 25 && <p className="text-[11px] text-muted mt-1">Leaves {Math.round(current.leave)} on average.</p>}
        </div>
      )}
      {open && plan && (
        <div className="flex flex-col gap-1.5" data-testid="plays">
          {plan.plays.map((p: Play) => {
            const isPick = picked && p.sim.club === picked.club && p.sim.aimOffset === picked.aimOffset;
            return (
              <button key={p.kind} type="button" onClick={() => onPlay(p.sim.club, p.sim.aim)} className={`grid grid-cols-[auto_1fr_auto] gap-x-2 items-center rounded-lg border px-2 py-1.5 text-left ${isPick ? "border-brass bg-brass-soft" : "border-line bg-surface"}`} data-testid={`play-${p.kind}`} aria-pressed={!!isPick}>
                <span className={`text-[9px] uppercase tracking-wide font-bold row-span-2 ${isPick ? "text-accent" : "text-ink-2"}`}>{p.kind}</span>
                <span className="text-[12.5px] font-bold">{clubLabel(p.sim.club)} · {describeAim(p.sim.aimOffset)}</span>
                <span className="row-span-2 text-right font-display text-lg leading-none">{p.sim.expected.toFixed(1)}<span className="block text-[8px] font-sans font-semibold uppercase tracking-wide text-muted">strokes</span></span>
                <span className="text-[11px] text-ink-2">{playLine(p.sim)}</span>
              </button>
            );
          })}
          <label className="flex items-center gap-2 text-[11px] text-muted mt-0.5"><span>Safe</span><input type="range" min={-100} max={100} value={Math.round(risk * 100)} onChange={(e) => onRisk(Number(e.target.value) / 100)} className="flex-1 accent-[var(--brass)]" aria-label="Risk: safe to bold" /><span>Bold</span></label>
          <p className="text-[10px] text-muted">Tap a play to set that club and aim. Odds come from your bag dropped onto this hole&apos;s real shapes; the slider changes how much a bad miss counts.</p>
        </div>
      )}
    </div>
  );
}

/** Compact "whose shots" picker for the hole view: a select, and a chip list only when choosing players. */
export function ShotFilterControl({ mode, playerIds, players, me, hasGroups, onChange }: {
  mode: "me" | "group" | "all" | "custom"; playerIds: string[]; players: { playerId: string; name: string; color: string }[]; me: string; hasGroups: boolean;
  onChange: (mode: "me" | "group" | "all" | "custom", playerIds: string[]) => void;
}) {
  const shown = mode === "custom" ? players.filter((p) => playerIds.includes(p.playerId)) : [];
  return (
    <div className="flex flex-col gap-1.5 text-[11px]" data-testid="shot-filter">
      <div className="flex items-center gap-2">
        <span className="text-muted whitespace-nowrap">Shots shown</span>
        <select className="field !min-h-8 !py-0 !px-2 text-xs font-semibold flex-1" value={mode} aria-label="Whose shots to show" onChange={(e) => onChange(e.target.value as "me" | "group" | "all" | "custom", playerIds)}>
          <option value="me">Just me</option>
          {hasGroups && <option value="group">My group</option>}
          <option value="all">Everyone</option>
          <option value="custom">Choose players…</option>
        </select>
      </div>
      {mode === "custom" && (
        <div className="flex flex-wrap gap-1.5">
          {players.filter((p) => p.playerId !== me).map((p) => {
            const on = playerIds.includes(p.playerId);
            return (
              <button key={p.playerId} type="button" aria-pressed={on} onClick={() => onChange("custom", on ? playerIds.filter((x) => x !== p.playerId) : [...playerIds, p.playerId])} className={`tap !min-h-8 rounded-full pl-2 pr-3 font-semibold border inline-flex items-center gap-1.5 ${on ? "bg-ink text-[var(--bg)] border-ink" : "bg-surface border-line-strong"}`}>
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}
              </button>
            );
          })}
          {shown.length === 0 && <span className="text-muted self-center">Pick who to overlay.</span>}
        </div>
      )}
    </div>
  );
}

export function BagCard({ shots, playerId, playerName, bag, handicapIndex, onProfile }: { shots: Shot[]; playerId: string; playerName: string; bag: Bag; handicapIndex: number; onProfile: (club: Club, profile: ClubProfile | null) => void }) {
  const [open, setOpen] = useState<Club | null>(null);
  const models = Object.fromEntries(CLUBS.map((c) => [c, dispersionModel(c, bag, handicapIndex, shots, playerId)])) as Record<Club, DispersionModel>;
  const set = (c: Club, patch: Partial<ClubProfile>) => onProfile(c, { ...(bag[c] ?? defaultProfile(c, handicapIndex)), ...patch });
  const missWord = (m: DispersionModel) => (Math.abs(m.center.lateral) < 2 ? "straight" : `${Math.round(Math.abs(m.center.lateral))} ${m.center.lateral > 0 ? "R" : "L"}`);
  return (
    <Card title={`${playerName} · my bag`} action={<span className="text-xs text-muted">tap a club to set it</span>}>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {CLUBS.map((c) => {
          const m = models[c];
          const setByYou = !!bag[c];
          return (
            <button key={c} type="button" onClick={() => setOpen(open === c ? null : c)} aria-pressed={open === c} className={`rounded-lg py-1.5 ${open === c ? "ring-2 ring-brass" : ""} ${m.samples ? "bg-brass-soft" : setByYou ? "bg-surface-2" : "bg-surface-2/60"}`} data-testid={`bag-${c}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted">{clubLabel(c)}</p>
              <p className="font-display text-lg leading-tight">{Math.round(m.carry)}</p>
              <p className="text-[9px] text-ink-2">{missWord(m)} · ±{Math.round(m.sdLateral * 1.8)}</p>
              <p className="text-[9px] text-muted">{m.samples ? `${m.samples} shot${m.samples === 1 ? "" : "s"}` : setByYou ? "set by you" : "estimate"}</p>
            </button>
          );
        })}
      </div>
      {open && (() => {
        const prof = bag[open] ?? defaultProfile(open, handicapIndex);
        const m = models[open];
        return (
          <div className="mt-2 rounded-lg bg-surface-2/50 p-2 flex flex-col gap-2 text-sm" data-testid="club-editor">
            <div className="flex items-center justify-between">
              <span className="label !mb-0">{clubLabel(open)}</span>
              <span className="text-[11px] text-muted">{m.samples ? `${m.samples} aimed shots · ${m.confidence} confidence` : "no aimed shots yet"}</span>
            </div>
            <label className="flex items-center gap-2"><span className="w-20 text-muted text-xs">Carry</span>
              <button type="button" className="tap !min-h-8 !min-w-8 rounded-md bg-surface border border-line-strong text-sm font-bold" aria-label="5 yards shorter" onClick={() => set(open, { carry: Math.max(20, prof.carry - 5) })}>−5</button>
              <input className="field !min-h-8 w-20 !px-2 text-center" inputMode="numeric" aria-label={`${clubLabel(open)} carry`} value={prof.carry} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); if (n > 0) set(open, { carry: n }); }} />
              <button type="button" className="tap !min-h-8 !min-w-8 rounded-md bg-surface border border-line-strong text-sm font-bold" aria-label="5 yards longer" onClick={() => set(open, { carry: prof.carry + 5 })}>+5</button>
              <span className="text-xs text-muted">yds</span>
            </label>
            <div><span className="label">Usual miss</span><div className="seg">{(["left", "straight", "right", "two-way"] as MissBias[]).map((v) => <button key={v} type="button" aria-pressed={prof.miss === v} onClick={() => set(open, { miss: v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
            <div><span className="label">How wide</span><div className="seg">{(["narrow", "normal", "wide"] as MissWidth[]).map((v) => <button key={v} type="button" aria-pressed={prof.width === v} onClick={() => set(open, { width: v })} className="!text-xs !min-h-8">{v}</button>)}</div></div>
            <p className="text-[11px] text-muted">Model: carries {Math.round(m.carry)}, {missWord(m)}, 8 in 10 shots inside ±{Math.round(m.sdLateral * 1.8)} yds and {Math.round(m.sdLong * 1.8)} long/short. Your aimed shots refine this over time.{bag[open] && <> <button type="button" className="text-accent font-semibold" onClick={() => { onProfile(open, null); }}>Reset to estimate</button></>}</p>
          </div>
        );
      })()}
      <p className="mt-2 text-[11px] text-muted">Gold tiles are measured from aimed shots; grey are your entries or handicap-based estimates. These drive the club suggestion, the dispersion zone on the hole, and the lay-up numbers.</p>
    </Card>
  );
}
