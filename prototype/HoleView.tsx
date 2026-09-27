import { useMemo, useState } from "react";
import { buildHole, dist, ellipsePath, greenDistances, type Ellipse, type Pt } from "./holeGeometry";

/**
 * Tee-view hole card: a perspective rendering of the hole from behind the tee with the
 * line of play, hazards and live front / middle / back distances from "your" position.
 * In the real app the ground layer is Mapbox satellite imagery and the position comes
 * from GPS; here the layout is drawn from hole geometry and you tap to move.
 */
const W = 400, H = 250, HORIZON = 58, CX = 200;
const CAM_BACK = 150, F = 410, CAM_H = 56;

function project(p: Pt): { x: number; y: number; s: number } {
  const depth = Math.max(8, p.u + CAM_BACK);
  const s = F / depth;
  return { x: CX + p.v * s, y: HORIZON + CAM_H * s, s };
}
function unproject(x: number, y: number): Pt {
  const depth = (F * CAM_H) / Math.max(4, y - HORIZON);
  return { u: depth - CAM_BACK, v: ((x - CX) * depth) / F };
}
function path(pts: Pt[], close = true): string {
  return pts.map((p, i) => { const q = project(p); return `${i === 0 ? "M" : "L"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join(" ") + (close ? " Z" : "");
}
const ell = (e: Ellipse) => path(ellipsePath(e, 36));

export function HoleView({ holeNumber, par, yardage, strokeIndex }: { holeNumber: number; par: number; yardage: number | null; strokeIndex: number }) {
  const hole = useMemo(() => buildHole(holeNumber, par, yardage), [holeNumber, par, yardage]);
  const [pos, setPos] = useState<Pt>({ u: 0, v: 0 });
  const d = greenDistances(pos, hole.green);
  const atTee = dist(pos, hole.tee) < 1;
  const flag = hole.green.c;

  const pointAlong = (uTarget: number): Pt => {
    for (let i = 0; i < hole.line.length - 1; i++) {
      const a = hole.line[i], b = hole.line[i + 1];
      if (uTarget >= a.u && uTarget <= b.u) { const f = (uTarget - a.u) / (b.u - a.u || 1); return { u: uTarget, v: a.v + (b.v - a.v) * f }; }
    }
    return hole.line[hole.line.length - 1];
  };
  const markers = [100, 150, 200].filter((m) => m < hole.length - 30);
  const trees = [...hole.trees].sort((a, b) => b.u - a.u);

  const onTap = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    if (y < HORIZON + 6) return;
    const p = unproject(x, y);
    setPos({ u: Math.max(-10, Math.min(hole.length + 15, p.u)), v: Math.max(-120, Math.min(120, p.v)) });
  };

  const you = project(pos);
  const fl = project(flag);

  return (
    <div className="card overflow-hidden !p-0" data-testid="hole-view">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto cursor-crosshair select-none" onClick={onTap} role="img" aria-label={`Hole ${holeNumber} layout from the tee`}>
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b9c9d8" /><stop offset="100%" stopColor="#e6ece6" /></linearGradient>
            <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8aa66a" /><stop offset="100%" stopColor="#5f7f48" /></linearGradient>
            <linearGradient id="fw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a3c276" /><stop offset="100%" stopColor="#8fb463" /></linearGradient>
            <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e6ece6" stopOpacity="0.95" /><stop offset="100%" stopColor="#e6ece6" stopOpacity="0" /></linearGradient>
          </defs>
          <rect width={W} height={HORIZON + 1} fill="url(#sky)" />
          <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#ground)" />
          {/* far tree line on the horizon */}
          <path d={`M0 ${HORIZON + 2} ${Array.from({ length: 40 }, (_, i) => `L${i * 10.5} ${HORIZON - 1 - ((i * 7919) % 5)}`).join(" ")} L${W} ${HORIZON + 2} Z`} fill="#4c6f45" />
          {hole.water && <path d={path(hole.water)} fill="#6d9fc4" stroke="#4d7fa6" strokeWidth={1} />}
          {hole.fairway.length > 0 && <path d={path(hole.fairway)} fill="url(#fw)" stroke="#86ab5c" strokeWidth={0.8} />}
          {hole.bunkers.map((b, i) => <path key={i} d={ell(b)} fill="#e8dcb0" stroke="#cbbb84" strokeWidth={0.8} />)}
          <path d={ell({ ...hole.green, ru: hole.green.ru + 5, rv: hole.green.rv + 5 })} fill="#9cc873" opacity={0.7} />
          <path d={ell(hole.green)} fill="#b3dc8c" stroke="#79a95a" strokeWidth={1} />
          {trees.map((t, i) => { const q = project(t); const r = 7 * q.s * 1.2; return <g key={i}><ellipse cx={q.x + r * 0.3} cy={q.y + r * 0.2} rx={r * 1.1} ry={r * 0.4} fill="rgba(0,0,0,0.18)" /><circle cx={q.x} cy={q.y - r * 0.6} r={r} fill="#3f6a3c" /><circle cx={q.x - r * 0.3} cy={q.y - r * 0.9} r={r * 0.55} fill="#4f7d48" /></g>; })}
          {/* tee box */}
          <path d={path([{ u: -3, v: -7 }, { u: 5, v: -7 }, { u: 5, v: 7 }, { u: -3, v: 7 }])} fill="#b3dc8c" stroke="#79a95a" strokeWidth={0.8} />
          {/* line of play */}
          <path d={path([pos, flag], false)} stroke="#f7f3ea" strokeWidth={1.4} strokeDasharray="4 3" fill="none" opacity={0.9} />
          {markers.map((m) => { const q = project(pointAlong(m)); return <g key={m}><circle cx={q.x} cy={q.y} r={2.2} fill="#f7f3ea" /><text x={q.x + 5} y={q.y + 3} fontSize={8} fill="#f7f3ea" fontWeight={700} style={{ paintOrder: "stroke", stroke: "rgba(27,42,65,0.6)", strokeWidth: 2 }}>{m}</text></g>; })}
          {/* flag */}
          <line x1={fl.x} y1={fl.y} x2={fl.x} y2={fl.y - 22 * Math.min(1, fl.s * 3)} stroke="#f7f3ea" strokeWidth={1.3} />
          <path d={`M${fl.x} ${fl.y - 22 * Math.min(1, fl.s * 3)} l8 3.5 l-8 3.5 z`} fill="#7a1f2b" />
          {/* you */}
          <circle cx={you.x} cy={you.y} r={11} fill="none" stroke="#1b2a41" strokeWidth={1} opacity={0.5} />
          <circle cx={you.x} cy={you.y} r={5.5} fill="#1b2a41" stroke="#f7f3ea" strokeWidth={1.8} />
          <rect y={HORIZON} width={W} height={26} fill="url(#haze)" />
        </svg>
        <div className="absolute top-2 left-2 rounded-lg bg-ink/85 text-[var(--bg)] px-2.5 py-1.5 leading-tight">
          <div className="font-display text-xl">Hole {holeNumber}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-85">Par {par}{yardage ? ` · ${yardage} yds` : ""} · SI {strokeIndex}</div>
        </div>
        <div className="absolute top-2 right-2 flex gap-1" aria-label="Distances to green">
          {(["front", "middle", "back"] as const).map((k) => (
            <div key={k} className={`rounded-lg px-2 py-1 text-center leading-none ${k === "middle" ? "bg-[var(--bg)] text-ink" : "bg-ink/85 text-[var(--bg)]"}`}>
              <div className="text-[9px] uppercase tracking-wide opacity-80">{k[0]}</div>
              <div className="font-display text-lg" data-testid={`dist-${k}`}>{Math.round(d[k])}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-ink-2 border-t border-line">
        <span>{atTee ? "From the tee" : `${Math.round(dist(pos, hole.tee))} yds from the tee`} · yards · {atTee ? "tap the hole to move (GPS does this in the app)" : "distances from where you tapped"}</span>
        {!atTee && <button type="button" className="font-semibold text-accent whitespace-nowrap" onClick={() => setPos({ u: 0, v: 0 })}>Back to tee</button>}
      </div>
    </div>
  );
}
