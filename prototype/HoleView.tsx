import { useEffect, useMemo, useRef, useState } from "react";
import { buildHole, compassName, dist, ellipsePath, greenDistances, greenSurface, hazardDistances, holeConditions, layupPoint, playsLike, slopeColor, snapToGreen, tiltWords, type Ellipse, type Pt, type Wind } from "./holeGeometry";
import { missFromAim, type Shot } from "./shots";

/**
 * Hole card: a perspective rendering from behind wherever you are, looking at the flag,
 * zoomed so the remaining shot fills the frame. Shows the line of play, hazards, live
 * front / middle / back distances, an optional aim point and the logged shot trail.
 * In the real app the ground layer is Mapbox satellite imagery and the position comes
 * from GPS; here the layout is drawn from hole geometry and you tap to move.
 */
const W = 400, H = 300, CX = 200;
// "You" sit near the bottom of the frame and the flag lands near the top, whatever is left to play.
// Inside 250 yards the camera climbs (further back, horizon further above the frame) so the green
// has real depth on screen and an aim point can be placed accurately.
const NEAR_Y = 286, FLAG_Y = 74;

interface View {
  toView: (p: Pt) => Pt;
  project: (p: Pt) => { x: number; y: number; s: number };
  projectView: (q: Pt) => { x: number; y: number; s: number };
  unproject: (x: number, y: number) => Pt;
  near: number;
  /** Screen y of the horizon (above the frame when the camera is steep). */
  horizon: number;
  /** True for the top-down green view (no perspective). */
  overhead: boolean;
}
/** Inside this many yards of the flag the view switches to straight down over the green. */
const GREEN_VIEW_YDS = 40;

/** Camera behind `pos`, facing `flag`; zoom scales with the remaining distance. */
function makeView(pos: Pt, flag: Pt, green: Ellipse): View {
  const d0 = dist(pos, flag);
  const D = Math.max(15, d0);
  // forward: from you to the flag; straight up the hole when you're on top of it
  const fu = d0 > 1 ? (flag.u - pos.u) / d0 : 1, fv = d0 > 1 ? (flag.v - pos.v) / d0 : 0;
  const ru = -fv, rv = fu; // right of the line of play
  if (d0 <= GREEN_VIEW_YDS) return overheadView(pos, green, fu, fv);
  // steeper (more overhead) the closer you are: ratio of camera set-back to shot length
  const t = Math.min(1, Math.max(0, (D - 100) / 250)); // 0 inside 100 yds … 1 at 350+
  const back = 3.5 - 1.5 * t; // 3.5× inside 100 yds → 2× on long holes
  const camBack = back * D + 15;
  const HORIZON = FLAG_Y * (1 + back) - NEAR_Y * back; // solves flag → FLAG_Y, you → NEAR_Y
  // how squashed the green looks: near-round when close, more oblique from the tee
  const greenAspect = 0.66 - 0.36 * t;
  const vScaleAtFlag = ((NEAR_Y - HORIZON) * camBack) / ((camBack + D) * (camBack + D)); // px per yard of depth at the flag
  const frameAtFlag = W / (vScaleAtFlag / greenAspect); // yards visible across the frame at the flag
  const F = (W * (camBack + D)) / frameAtFlag; // focal length
  const camH = ((NEAR_Y - HORIZON) * camBack) / F; // puts "you" near the bottom of the frame
  const toView = (p: Pt): Pt => { const du = p.u - pos.u, dv = p.v - pos.v; return { u: du * fu + dv * fv, v: du * ru + dv * rv }; };
  const projectView = (q: Pt) => { const depth = Math.max(6, q.u + camBack); const s = F / depth; return { x: CX + q.v * s, y: HORIZON + camH * s, s }; };
  const project = (p: Pt) => projectView(toView(p));
  const unproject = (x: number, y: number): Pt => {
    const depth = (F * camH) / Math.max(4, y - HORIZON);
    const vu = depth - camBack, vv = ((x - CX) * depth) / F;
    return { u: pos.u + vu * fu + vv * ru, v: pos.v + vu * fv + vv * rv };
  };
  return { toView, project, projectView, unproject, near: -camBack + 8, horizon: HORIZON, overhead: false };
}
/** Straight down over the green, rotated so the line from you to the flag points up the screen. */
function overheadView(pos: Pt, green: Ellipse, fu: number, fv: number): View {
  const ru = -fv, rv = fu;
  const CY = H * 0.52;
  const s = (H * 0.62) / (2 * Math.max(green.ru, green.rv)); // px per yard: green fills ~60% of the height
  const toView = (p: Pt): Pt => { const du = p.u - green.c.u, dv = p.v - green.c.v; return { u: du * fu + dv * fv, v: du * ru + dv * rv }; };
  const projectView = (q: Pt) => ({ x: CX + q.v * s, y: CY - q.u * s, s });
  const project = (p: Pt) => projectView(toView(p));
  const unproject = (x: number, y: number): Pt => { const vu = (CY - y) / s, vv = (x - CX) / s; return { u: green.c.u + vu * fu + vv * ru, v: green.c.v + vu * fv + vv * rv }; };
  void pos;
  return { toView, project, projectView, unproject, near: -1e9, horizon: -1e9, overhead: true };
}

/** Clip a polygon (view coords) to the half-space in front of the camera. */
function clipNear(pts: Pt[], near: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const aIn = a.u >= near, bIn = b.u >= near;
    if (aIn) out.push(a);
    if (aIn !== bIn) { const t = (near - a.u) / (b.u - a.u); out.push({ u: near, v: a.v + (b.v - a.v) * t }); }
  }
  return out;
}

function polyPath(view: View, pts: Pt[]): string {
  const clipped = clipNear(pts.map(view.toView), view.near);
  if (clipped.length < 3) return "";
  return clipped.map((q, i) => { const s = view.projectView(q); return `${i === 0 ? "M" : "L"}${s.x.toFixed(1)} ${s.y.toFixed(1)}`; }).join(" ") + " Z";
}
function linePath(view: View, a: Pt, b: Pt): string {
  const qa = view.toView(a), qb = view.toView(b);
  const seg = clipNear([qa, qb, qb], view.near);
  if (seg.length < 2) return "";
  const A = view.projectView(seg[0]), B = view.projectView(seg[1]);
  return `M${A.x.toFixed(1)} ${A.y.toFixed(1)} L${B.x.toFixed(1)} ${B.y.toFixed(1)}`;
}

/** Another player's shots on this hole, drawn in their colour. */
export interface OtherTrail { playerId: string; name: string; color: string; shots: Shot[] }
export const TRAIL_COLORS = ["#e4572e", "#3a86ff", "#ffd166", "#c77dff", "#00b4d8", "#f7f3ea", "#ff8fab", "#8ac926"];

const fmtAdj = (n: number) => (Math.abs(n) < 0.5 ? "(±0)" : `(${n > 0 ? "+" : "−"}${Math.round(Math.abs(n))})`);
const label = { fontSize: 8, fill: "#f7f3ea", fontWeight: 700, style: { paintOrder: "stroke" as const, stroke: "rgba(27,42,65,0.6)", strokeWidth: 2 } };

export function HoleView({ holeNumber, par, yardage, strokeIndex, numbers, onNumbersChange, wind, onWindChange, tracking, shots, onShot, onMoveShot, focusShot, others = [], aim, aimMode, onSetAim }: {
  holeNumber: number; par: number; yardage: number | null; strokeIndex: number; numbers: number[]; onNumbersChange: (n: number[]) => void; wind: Wind; onWindChange: (w: Wind) => void;
  tracking: boolean; shots: Shot[]; onShot: (to: Pt) => void; onMoveShot: (id: string, to: Pt, first: boolean) => void; focusShot?: Shot | null; others?: OtherTrail[]; aim: Pt | null; aimMode: boolean; onSetAim: (p: Pt) => void;
}) {
  const [editNumbers, setEditNumbers] = useState(false);
  const [editWind, setEditWind] = useState(false);
  const cond = useMemo(() => holeConditions(holeNumber, par), [holeNumber, par]);
  const hole = useMemo(() => buildHole(holeNumber, par, yardage), [holeNumber, par, yardage]);
  const [tapPos, setTapPos] = useState<Pt>({ u: 0, v: 0 });
  // While tracking, "you" are wherever the last logged shot came to rest.
  const lastRest = shots.length ? shots[shots.length - 1].to : null;
  const pos = useMemo<Pt>(() => (tracking ? (lastRest ?? { u: 0, v: 0 }) : tapPos), [tracking, lastRest, tapPos]);
  const flag = hole.green.c;
  // While a marker is being dragged the camera stays put, otherwise it would slide under the finger.
  const [frozenPos, setFrozenPos] = useState<Pt | null>(null);
  // Editing an earlier shot? Look at the hole from where that shot started so it is in frame to drag.
  const camPos = frozenPos ?? (focusShot ? focusShot.from : pos);
  const view = useMemo(() => makeView(camPos, flag, hole.green), [camPos, flag, hole.green]);
  const surface = useMemo(() => greenSurface(holeNumber, hole.green, cond.tilt), [holeNumber, hole.green, cond.tilt]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ kind: "aim" | "shot" | "you"; id?: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    // React registers touch listeners as passive; block page scroll ourselves while a drag is live.
    const el = svgRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);
  const d = greenDistances(pos, hole.green);
  const atTee = dist(pos, hole.tee) < 1;

  const pointAlong = (uTarget: number): Pt => {
    for (let i = 0; i < hole.line.length - 1; i++) {
      const a = hole.line[i], b = hole.line[i + 1];
      if (uTarget >= a.u && uTarget <= b.u) { const f = (uTarget - a.u) / (b.u - a.u || 1); return { u: uTarget, v: a.v + (b.v - a.v) * f }; }
    }
    return hole.line[hole.line.length - 1];
  };
  const ahead = (p: Pt) => view.toView(p).u > view.near + 2;
  const markers = [100, 150, 200].filter((m) => m < hole.length - 30).map((m) => ({ m, p: pointAlong(m) })).filter(({ p }) => ahead(p));
  const trees = hole.trees.filter(ahead).sort((a, b) => view.toView(b).u - view.toView(a).u);

  /** Screen point → world point on the ground, clamped to the hole corridor; null above the horizon. */
  const worldAt = (clientX: number, clientY: number): Pt | null => {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    if (y < view.horizon + 6) return null;
    const p = view.unproject(x, y);
    return { u: Math.max(-10, Math.min(hole.length + 25, p.u)), v: Math.max(-140, Math.min(140, p.v)) };
  };
  const onTap = (e: React.MouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const p = worldAt(e.clientX, e.clientY);
    if (!p) return;
    if (tracking && aimMode) onSetAim(p);
    else if (tracking) onShot(snapToGreen(hole.green, p, 6)); // a tap just off the edge means "on the green"
    else setTapPos(p);
  };
  const startDrag = (kind: "aim" | "shot" | "you", id?: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = { kind, id, moved: false };
    setFrozenPos(camPos);
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = worldAt(e.clientX, e.clientY);
    if (!p) return;
    const first = !d.moved;
    d.moved = true;
    if (d.kind === "aim") onSetAim(p);
    else if (d.kind === "shot" && d.id) onMoveShot(d.id, p, first);
    else if (d.kind === "you") setTapPos(p);
  };
  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setFrozenPos(null);
    if (d.moved) suppressClick.current = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const grab = { style: { touchAction: "none" as const, cursor: "grab" as const } };

  const you = view.project(pos);
  const fl = view.project(flag);
  const hazards = hazardDistances(pos, flag, hole).slice(0, 4);
  const pl = playsLike(pos, flag, hole.length, cond, wind);
  // Wind arrow relative to the view: 0° = up the screen (the direction you're facing).
  const shotBearing = pl.shotBearingDeg;
  const windRel = ((wind.fromDeg + 180 - shotBearing) % 360 + 360) % 360;
  const layups = numbers.map((n) => ({ n, ...layupPoint(pos, flag, n) })).filter((l) => l.point) as { n: number; point: Pt; distance: number }[];
  const aimPt = aim ? view.project(aim) : null;
  const aimDist = aim ? dist(pos, aim) : null;

  return (
    <div className="card overflow-hidden !p-0" data-testid="hole-view">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className={`block w-full h-auto select-none ${aimMode ? "cursor-cell" : "cursor-crosshair"}`} onClick={onTap} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag} ref={svgRef} role="img" aria-label={`Hole ${holeNumber} view from your position`}>
          <defs>
            <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8aa66a" /><stop offset="100%" stopColor="#5f7f48" /></linearGradient>
            <linearGradient id="fw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a3c276" /><stop offset="100%" stopColor="#8fb463" /></linearGradient>
          </defs>
          <rect width={W} height={H} fill="url(#ground)" />
          {hole.water && <path d={polyPath(view, hole.water)} fill="#6d9fc4" stroke="#4d7fa6" strokeWidth={1} />}
          {hole.fairway.length > 0 && <path d={polyPath(view, hole.fairway)} fill="url(#fw)" stroke="#86ab5c" strokeWidth={0.8} />}
          {hole.bunkers.map((b, i) => <path key={i} d={polyPath(view, ellipsePath(b, 36))} fill="#e8dcb0" stroke="#cbbb84" strokeWidth={0.8} />)}
          <path d={polyPath(view, ellipsePath({ ...hole.green, ru: hole.green.ru + 5, rv: hole.green.rv + 5 }, 36))} fill="#9cc873" opacity={0.7} />
          <path d={polyPath(view, ellipsePath(hole.green, 36))} fill="#b3dc8c" stroke="#79a95a" strokeWidth={1} />
          {/* putting-surface slopes: colour by grade, arrows point downhill (overhead view) */}
          <defs><clipPath id={`green-clip-${holeNumber}`}><path d={polyPath(view, ellipsePath(hole.green, 36))} /></clipPath></defs>
          <g clipPath={`url(#green-clip-${holeNumber})`} opacity={view.overhead ? 0.95 : 0.8}>
            {surface.cells.map((c, i) => { const h = c.half * 1.04; return <path key={i} d={polyPath(view, [{ u: c.c.u - h, v: c.c.v - h }, { u: c.c.u + h, v: c.c.v - h }, { u: c.c.u + h, v: c.c.v + h }, { u: c.c.u - h, v: c.c.v + h }])} fill={slopeColor(c.pct)} />; })}
          </g>
          {/* downhill arrows: dense straight down over the green, sparse on the approach, none from far out */}
          {surface.arrows.filter((_, i) => view.overhead || (dist(pos, flag) <= 130 && i % 4 === 0)).map((c, i) => {
            const len = (view.overhead ? 2.2 : 3.6) * Math.min(1, c.pct / 3);
            const a = view.project(c.c), b = view.project({ u: c.c.u + c.du * len, v: c.c.v + c.dv * len });
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const hd = view.overhead ? 4.2 : 5;
            const head = `M${b.x} ${b.y} L${b.x - hd * Math.cos(ang - 0.55)} ${b.y - hd * Math.sin(ang - 0.55)} L${b.x - hd * Math.cos(ang + 0.55)} ${b.y - hd * Math.sin(ang + 0.55)} Z`;
            return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f7f3ea" strokeWidth={3} strokeLinecap="round" opacity={0.8} /><path d={head} fill="#f7f3ea" stroke="#f7f3ea" strokeWidth={2} strokeLinejoin="round" opacity={0.8} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1b2a41" strokeWidth={1.3} strokeLinecap="round" /><path d={head} fill="#1b2a41" /></g>;
          })}
          {trees.map((t, i) => { const q = view.project(t); const r = Math.min(26, 4.5 * q.s); return <g key={i}><ellipse cx={q.x + r * 0.3} cy={q.y + r * 0.2} rx={r * 1.1} ry={r * 0.4} fill="rgba(0,0,0,0.18)" /><circle cx={q.x} cy={q.y - r * 0.6} r={r} fill="#3f6a3c" /><circle cx={q.x - r * 0.3} cy={q.y - r * 0.9} r={r * 0.55} fill="#4f7d48" /></g>; })}
          {/* tee box */}
          <path d={polyPath(view, [{ u: -3, v: -7 }, { u: 5, v: -7 }, { u: 5, v: 7 }, { u: -3, v: 7 }])} fill="#b3dc8c" stroke="#79a95a" strokeWidth={0.8} />
          {/* line of play */}
          <path d={linePath(view, pos, flag)} stroke="#f7f3ea" strokeWidth={1.4} strokeDasharray="4 3" fill="none" opacity={0.9} />
          {markers.map(({ m, p }) => { const q = view.project(p); return <g key={m}><circle cx={q.x} cy={q.y} r={2.2} fill="#f7f3ea" /><text x={q.x + 5} y={q.y + 3} {...label}>{m}</text></g>; })}
          {/* flag */}
          <line x1={fl.x} y1={fl.y} x2={fl.x} y2={fl.y - 22 * Math.min(1, fl.s * 3)} stroke="#f7f3ea" strokeWidth={1.3} />
          <path d={`M${fl.x} ${fl.y - 22 * Math.min(1, fl.s * 3)} l8 3.5 l-8 3.5 z`} fill="#7a1f2b" />
          {/* everyone else's trails: thin lines in their colour, initial on the last rest point */}
          {others.map((o) => o.shots.map((sh, i) => {
            const isLast = i === o.shots.length - 1;
            const b = view.project(sh.to);
            return (
              <g key={sh.id} data-testid={`trail-${o.playerId}`}>
                {ahead(sh.from) && <path d={linePath(view, sh.from, sh.to)} stroke={o.color} strokeWidth={1.1} fill="none" opacity={0.85} />}
                {ahead(sh.to) && <circle cx={b.x} cy={b.y} r={isLast ? 4 : 2.4} fill={o.color} stroke="rgba(27,42,65,0.7)" strokeWidth={0.8} />}
                {ahead(sh.to) && isLast && <text x={b.x} y={b.y + 2.6} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="#1b2a41">{o.name[0]}</text>}
              </g>
            );
          }))}
          {/* logged shots, with their aim point and miss when one was set */}
          {shots.map((sh) => {
            const a = view.project(sh.from), b = view.project(sh.to);
            const am = sh.aim && ahead(sh.aim) ? view.project(sh.aim) : null;
            return (
              <g key={sh.id}>
                {ahead(sh.from) && <path d={linePath(view, sh.from, sh.to)} stroke="#b08d3c" strokeWidth={1.6} fill="none" />}
                {am && <><circle cx={am.x} cy={am.y} r={3.5} fill="none" stroke="#f7f3ea" strokeWidth={1.2} strokeDasharray="2 1.5" /><line x1={am.x} y1={am.y} x2={b.x} y2={b.y} stroke="#f7f3ea" strokeWidth={0.8} opacity={0.7} /></>}
                {ahead(sh.to) && <><circle cx={b.x} cy={b.y} r={3.2} fill="#b08d3c" stroke="#f7f3ea" strokeWidth={1} />{tracking && <circle cx={b.x} cy={b.y} r={14} fill="transparent" {...grab} onPointerDown={startDrag("shot", sh.id)} data-testid={`shot-handle-${sh.seq}`} aria-label={`Drag shot ${sh.seq}`} />}<text x={(a.x + b.x) / 2 + 4} y={(a.y + b.y) / 2} {...label}>{sh.club === "putt" ? `${Math.round(dist(sh.from, flag) * 3)} ft` : `${sh.club} ${Math.round(sh.distance)}`}</text></>}
              </g>
            );
          })}
          {/* lay-up spots for "your numbers" */}
          {layups.map((l, i) => { const q = view.project(l.point); const left = i % 2 === 1; return <g key={l.n}><circle cx={q.x} cy={q.y} r={4} fill="#b08d3c" stroke="#f7f3ea" strokeWidth={1.2} /><text x={left ? q.x - 6 : q.x + 6} y={q.y + 3} textAnchor={left ? "end" : "start"} {...label}>{l.n} in</text></g>; })}
          {/* aim point for the next shot */}
          {aimPt && aim && (
            <g data-testid="aim-marker">
              <path d={linePath(view, pos, aim)} stroke="#b08d3c" strokeWidth={1.2} strokeDasharray="2 2" fill="none" />
              <circle cx={aimPt.x} cy={aimPt.y} r={9} fill="none" stroke="#f7f3ea" strokeWidth={1.4} />
              <circle cx={aimPt.x} cy={aimPt.y} r={2} fill="#f7f3ea" />
              <line x1={aimPt.x - 13} y1={aimPt.y} x2={aimPt.x - 5} y2={aimPt.y} stroke="#f7f3ea" strokeWidth={1.2} /><line x1={aimPt.x + 5} y1={aimPt.y} x2={aimPt.x + 13} y2={aimPt.y} stroke="#f7f3ea" strokeWidth={1.2} />
              <line x1={aimPt.x} y1={aimPt.y - 13} x2={aimPt.x} y2={aimPt.y - 5} stroke="#f7f3ea" strokeWidth={1.2} /><line x1={aimPt.x} y1={aimPt.y + 5} x2={aimPt.x} y2={aimPt.y + 13} stroke="#f7f3ea" strokeWidth={1.2} />
              <text x={aimPt.x + 15} y={aimPt.y + 3} {...label}>aim {Math.round(aimDist ?? 0)}</text>
              <circle cx={aimPt.x} cy={aimPt.y} r={16} fill="transparent" {...grab} onPointerDown={startDrag("aim")} data-testid="aim-handle" aria-label="Drag aim point" />
            </g>
          )}
          {/* you */}
          {ahead(pos) && <>
            <circle cx={you.x} cy={you.y} r={11} fill="none" stroke="#1b2a41" strokeWidth={1} opacity={0.5} />
            <circle cx={you.x} cy={you.y} r={5.5} fill="#1b2a41" stroke="#f7f3ea" strokeWidth={1.8} />
            {!tracking && <circle cx={you.x} cy={you.y} r={16} fill="transparent" {...grab} onPointerDown={startDrag("you")} aria-label="Drag your position" />}
          </>}
        </svg>
        <div className="absolute top-2 left-2 rounded-lg bg-ink/85 text-[var(--bg)] px-2.5 py-1.5 leading-tight">
          <div className="font-display text-xl">Hole {holeNumber}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-85">Par {par}{yardage ? ` · ${yardage} yds` : ""} · SI {strokeIndex}</div>
        </div>
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <div className="flex gap-1" aria-label="Distances to green">
            {(["front", "middle", "back"] as const).map((k) => (
              <div key={k} className={`rounded-lg px-2 py-1 text-center leading-none ${k === "middle" ? "bg-[var(--bg)] text-ink" : "bg-ink/85 text-[var(--bg)]"}`}>
                <div className="text-[9px] uppercase tracking-wide opacity-80">{k[0]}</div>
                <div className="font-display text-lg" data-testid={`dist-${k}`}>{Math.round(d[k])}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-brass px-2 py-1 leading-none text-ink flex items-baseline gap-1.5" data-testid="plays-like">
            <span className="text-[9px] uppercase tracking-wide font-semibold">Plays like</span>
            <span className="font-display text-lg">{Math.round(pl.playsLike)}</span>
          </div>
        </div>
        <button type="button" onClick={() => setEditWind((e) => !e)} className="absolute left-2 bottom-2 rounded-lg bg-ink/85 text-[var(--bg)] px-2 py-1 flex items-center gap-1.5 leading-none" aria-label="Wind">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" /><g transform={`rotate(${windRel} 12 12)`}><path d="M12 4 L15.5 12 L12 10.2 L8.5 12 Z" fill="#b08d3c" /><line x1="12" y1="10" x2="12" y2="20" stroke="#b08d3c" strokeWidth="2" strokeLinecap="round" /></g></svg>
          <span className="text-[10px] font-semibold">{wind.mph} mph from {compassName(wind.fromDeg)}</span>
        </button>
        {aimMode && <div className="absolute bottom-2 inset-x-0 text-center pointer-events-none"><span className="rounded-md bg-brass px-3 py-1 text-[11px] font-semibold text-ink">Tap where you&apos;re aiming</span></div>}
      </div>
      <div className="px-3 py-2 border-t border-line flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" data-testid="plays-like-breakdown">
          <span className="font-semibold text-ink">Plays like {Math.round(pl.playsLike)} to the middle</span>
          <span className="text-ink-2">{Math.abs(pl.elevationRemainingFt) < 2 ? "level" : `${Math.round(Math.abs(pl.elevationRemainingFt))} ft ${pl.elevationRemainingFt > 0 ? "uphill" : "downhill"}`} {fmtAdj(pl.elevationAdj)}</span>
          <span className="text-ink-2">{Math.abs(pl.headwindMph) < 1 ? "no wind along the shot" : `${Math.round(Math.abs(pl.headwindMph))} mph ${pl.headwindMph > 0 ? "into" : "helping"}`} {fmtAdj(pl.windAdj)}{Math.abs(pl.crosswindMph) >= 3 ? ` · ${Math.round(Math.abs(pl.crosswindMph))} mph across ${pl.crosswindMph > 0 ? "L→R" : "R→L"}` : ""}</span>
          <span className="text-ink-2">Green falls {tiltWords(cond.tilt)} · {cond.tilt.pct}%</span>
        </div>
        {editWind && (
          <div className="rounded-lg bg-surface-2/70 p-2 flex flex-col gap-2 text-[11px]">
            <label className="flex items-center gap-2"><span className="w-16 text-muted">Wind</span><input type="range" min={0} max={30} value={wind.mph} onChange={(e) => onWindChange({ ...wind, mph: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="Wind speed" /><span className="w-14 text-right font-semibold">{wind.mph} mph</span></label>
            <div className="flex items-center gap-2"><span className="w-16 text-muted">From</span>
              <div className="seg flex-1">{["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((n, i) => <button key={n} type="button" aria-pressed={compassName(wind.fromDeg) === n} onClick={() => onWindChange({ ...wind, fromDeg: i * 45 })} className="!min-h-8 !text-[11px]">{n}</button>)}</div>
            </div>
            <span className="text-muted">The app reads the hourly forecast for the course; adjust here to see the effect. Hole {holeNumber} plays toward {compassName(cond.bearingDeg)}.</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5" aria-label="Hazards in play">
          {hazards.length === 0 && <span className="text-[11px] text-muted">Nothing in play between you and the green.</span>}
          {hazards.map((h, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[11px] font-semibold text-ink" data-testid="hazard-chip">
              <span className={`inline-block h-2 w-2 rounded-sm ${h.kind === "water" ? "bg-[#6d9fc4]" : h.kind === "bunker" ? "bg-[#e0d09c]" : "bg-[#3f6a3c]"}`} />
              {h.kind === "bunker" ? "Bunker" : h.kind === "water" ? "Water" : "Trees"} {h.side} · {Math.round(h.to)}{h.kind !== "trees" && <span className="text-muted font-normal">–{Math.round(h.carry)}</span>}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-muted">Your numbers:</span>
            {numbers.map((n) => {
              const l = layups.find((x) => x.n === n);
              return (
                <span key={n} className="inline-flex items-center gap-1 rounded-md bg-brass-soft px-2 py-1 font-semibold text-ink" data-testid="number-chip">
                  <span className="inline-block h-2 w-2 rounded-full bg-brass" />{l ? `hit ${Math.round(l.distance)} to leave ${n}` : `${n}: pin is inside it`}
                </span>
              );
            })}
            <button type="button" className="text-accent font-semibold" onClick={() => setEditNumbers((e) => !e)}>{editNumbers ? "Done" : "Edit"}</button>
          </div>
          {!atTee && !tracking && <button type="button" className="font-semibold text-accent whitespace-nowrap" onClick={() => setTapPos({ u: 0, v: 0 })}>Back to tee</button>}
        </div>
        {editNumbers && (
          <div className="flex flex-wrap gap-1.5 items-center text-[11px]">
            {[100, 120, 140, 150, 160, 175, 200].map((n) => {
              const on = numbers.includes(n);
              return <button key={n} type="button" aria-pressed={on} onClick={() => onNumbersChange(on ? numbers.filter((x) => x !== n) : [...numbers, n].sort((a, b) => a - b))} className={`tap !min-h-8 rounded-full px-3 font-semibold border ${on ? "bg-ink text-[var(--bg)] border-ink" : "bg-surface border-line-strong"}`}>{n}</button>;
            })}
            <span className="text-muted">Yardages you like to hit into greens. Saved to your player settings.</span>
          </div>
        )}
        <p className="text-[10px] text-muted">
          {atTee ? "From the tee" : `${Math.round(dist(pos, hole.tee))} yds from the tee`} · yards · the view follows you and zooms to what&apos;s left, straight down over the green inside 40 ·{" "}
          {tracking ? (aimMode ? "tap the hole to set your aim" : "tap where your ball came to rest, or drag a ball or the aim point to move it (GPS marks it in the app)") : "tap the hole or drag the dot to move (GPS does this in the app)"}
        </p>
        {shots.some((s) => s.aim) && (
          <p className="text-[10px] text-muted" data-testid="miss-summary">
            {shots.filter((s) => s.aim).map((s) => { const m = missFromAim(s)!; return `Shot ${s.seq}: ${Math.round(Math.abs(m.lateral))} yds ${m.lateral >= 0 ? "right" : "left"} of aim, ${Math.round(Math.abs(m.long))} ${m.long >= 0 ? "long" : "short"}`; }).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
