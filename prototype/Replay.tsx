/**
 * Round replay: flies each hole played so far while everyone's tracked shots land in order,
 * then holds on the scores and the money that moved on that hole. Pure playback over the
 * round's stored shots and ledger; nothing here changes state.
 */
import { useEffect, useRef, useState } from "react";
import { useApp } from "./App";
import { ReplayScene, TRAIL_COLORS, type ReplayTrail } from "./HoleView";
import { findScore, holeMoney, holeShapeFor, holeShots, satelliteOn, type Snapshot } from "./store";
import { money } from "../src/lib/format";

const FLY_MS = 3800, HOLD_MS = 1600;
/** A hole is in the replay once anyone has a score or a tracked shot on it. */
export function replayableHoles(snap: Snapshot) {
  return snap.holes.filter((h) => snap.players.some((p) => holeShots(snap.round, p.playerId, h.holeNumber).length > 0 || findScore(snap.round, p.playerId, h.holeNumber).entry.grossScore !== null));
}
const scoreWord = (toPar: number) => (toPar <= -3 ? "albatross" : toPar === -2 ? "eagle" : toPar === -1 ? "birdie" : toPar === 0 ? "par" : toPar === 1 ? "bogey" : toPar === 2 ? "double" : `+${toPar}`);

export function RoundReplay({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const { state } = useApp();
  const holes = replayableHoles(snap);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState(0); // 0 … 1 flying, 1 … 1 + hold while the banner shows
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const holdFrac = HOLD_MS / FLY_MS;
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    const step = (now: number) => {
      const dt = last.current === null ? 0 : now - last.current;
      last.current = now;
      setPhase((p) => {
        const next = p + (dt * speed) / FLY_MS;
        if (next < 1 + holdFrac) return next;
        // hole finished: on to the next, or stop on the last banner
        setIdx((i) => { if (i + 1 < holes.length) return i + 1; setPlaying(false); return i; });
        return idx + 1 < holes.length ? 0 : 1 + holdFrac;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [playing, speed, holes.length, holdFrac, idx]);
  const hole = holes[idx];
  if (!hole) return null;
  const shape = holeShapeFor(state, snap.round.courseId, hole.holeNumber);
  const t = Math.min(1, phase);
  const players = snap.players.map((p, i) => ({ ...p, color: TRAIL_COLORS[i % TRAIL_COLORS.length], shots: holeShots(snap.round, p.playerId, hole.holeNumber) }));
  // Shots land in playing order: everyone's first shot, then everyone's second, and so on.
  const order = players.flatMap((p) => p.shots.map((s) => ({ playerId: p.playerId, seq: s.seq, id: s.id }))).sort((a, b) => a.seq - b.seq || a.playerId.localeCompare(b.playerId));
  const K = Math.max(1, order.length);
  const windowFor = (id: string) => { const k = order.findIndex((o) => o.id === id); const start = 0.06 + (0.8 * k) / K, dur = (0.8 / K) * 0.85; return { start, dur }; };
  const trails: ReplayTrail[] = players.map((p) => ({ playerId: p.playerId, name: p.displayName, color: p.color, shots: p.shots.map((shot) => { const w = windowFor(shot.id); return { shot, progress: Math.max(0, Math.min(1, (t - w.start) / w.dur)) }; }) }));
  const banner = phase >= 0.86;
  const runningMoney = (playerId: string) => { const by = holeMoney(snap, playerId); return Object.entries(by).filter(([h]) => Number(h) <= hole.holeNumber).reduce((a, [, c]) => a + c, 0); };
  const go = (i: number) => { setIdx(Math.max(0, Math.min(holes.length - 1, i))); setPhase(0); last.current = null; };
  return (
    <div className="fixed inset-0 z-50 text-[var(--bg)] flex flex-col" style={{ background: "var(--ink)" }} role="dialog" aria-label="Round replay" data-testid="replay">
      <div className="flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        <div>
          <p className="text-[10px] uppercase tracking-wide opacity-75">Replay · {snap.course.name} · {idx + 1} of {holes.length}</p>
          <h2 className="font-display text-2xl leading-tight">Hole {hole.holeNumber} <span className="text-base opacity-80">· par {hole.par}{hole.yardage ? ` · ${hole.yardage} yds` : ""}</span></h2>
        </div>
        <button type="button" onClick={onClose} className="tap rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold" aria-label="Close replay" data-testid="replay-close">Close</button>
      </div>
      <div className="mx-auto w-full max-w-md px-3">
        <div className="rounded-xl overflow-hidden ring-1 ring-white/15"><ReplayScene hole={shape} holeNumber={hole.holeNumber} t={t} trails={trails} satellite={satelliteOn(state)} /></div>
        <div className="h-1 mt-2 rounded bg-white/15 overflow-hidden"><div className="h-full bg-brass" style={{ width: `${Math.min(100, (phase / (1 + holdFrac)) * 100)}%` }} /></div>
      </div>
      <div className={`mx-auto w-full max-w-md px-3 mt-3 transition-opacity duration-300 ${banner ? "opacity-100" : "opacity-0"}`} data-testid="replay-banner" aria-hidden={!banner}>
        <ul className="divide-y divide-white/10 rounded-xl bg-white/5">
          {players.map((p) => {
            const e = findScore(snap.round, p.playerId, hole.holeNumber).entry;
            const toPar = e.grossScore !== null ? e.grossScore - hole.par : null;
            const swing = holeMoney(snap, p.playerId)[hole.holeNumber] ?? 0;
            const run = runningMoney(p.playerId);
            return (
              <li key={p.playerId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ background: p.color }} />
                <span className="font-semibold flex-1">{p.displayName}</span>
                <span className="w-24 text-right">{e.grossScore !== null ? <>{e.grossScore} <span className="opacity-75 text-xs">{scoreWord(toPar!)}</span></> : <span className="opacity-50 text-xs">no score</span>}</span>
                <span className={`w-16 text-right tabular-nums text-xs ${swing > 0 ? "text-brass" : swing < 0 ? "text-[#f0b4b4]" : "opacity-50"}`}>{swing ? `${swing > 0 ? "+" : "−"}${money(Math.abs(swing))}` : "–"}</span>
                <span className={`w-16 text-right tabular-nums font-semibold ${run > 0 ? "text-brass" : run < 0 ? "text-[#f0b4b4]" : "opacity-60"}`}>{run ? `${run > 0 ? "+" : "−"}${money(Math.abs(run))}` : "even"}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-[10px] opacity-60 mt-1 px-1">Score · this hole&apos;s money (skins and single-hole bets) · running total of hole money</p>
      </div>
      <div className="mt-auto mx-auto w-full max-w-md px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 flex items-center justify-center gap-2" data-testid="replay-controls">
        <button type="button" className="tap rounded-full bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous hole">‹ Prev</button>
        <button type="button" className="tap rounded-full bg-brass text-ink px-5 py-2 text-sm font-bold" onClick={() => { if (!playing && idx === holes.length - 1 && phase >= 1 + holdFrac) go(0); setPlaying((p) => !p); }} data-testid="replay-play" aria-pressed={playing}>{playing ? "Pause" : idx === holes.length - 1 && phase >= 1 + holdFrac ? "Replay" : "Play"}</button>
        <button type="button" className="tap rounded-full bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40" onClick={() => go(idx + 1)} disabled={idx >= holes.length - 1} aria-label="Next hole">Next ›</button>
        <button type="button" className="tap rounded-full bg-white/10 px-3 py-2 text-xs font-semibold" onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} aria-label="Playback speed" data-testid="replay-speed">{speed}×</button>
      </div>
    </div>
  );
}
