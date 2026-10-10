import { useEffect, useMemo, useRef, useState } from "react";
import { buildHole, bunkerOutlines, compassName, DEFAULT_CONDITIONS, dist, elevationAt, ellipsePath, fairwayOutlines, greenDistances, greenOutline, greenSurface, hazardDistances, holeConditions, layupPoint, playsLike, slopeColor, snapToGreen, tiltWords, waterOutlines, type Conditions, type ElevationSample, type Ellipse, type HolePhoto, type HoleShape, type Pt, type Wind } from "./holeGeometry";
import { missFromAim, type Shot } from "./shots";
import { dispersionOutline, expectedFinish, expectedLanding, type DispersionModel } from "./bag";
import { applyFlight, type FlightEnv } from "./flight";

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
  /** Pixels per yard for the overhead views (undefined in perspective). */
  scale?: number;
}
/** Camera presets: follow the ball (today's view), the whole hole from above, or straight down over the green. */
export type CameraPreset = "ball" | "hole" | "green";
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
function overheadView(pos: Pt, green: Ellipse, fu: number, fv: number, includeBall = true): View {
  const ru = -fv, rv = fu;
  const toView = (p: Pt): Pt => { const du = p.u - green.c.u, dv = p.v - green.c.v; return { u: du * fu + dv * fv, v: du * ru + dv * rv }; };
  // Fit the whole green AND the ball: zoom out until both sit between the top and bottom overlays.
  const maxR = Math.max(green.ru, green.rv);
  const ballU = includeBall ? toView(pos).u : -maxR; // negative: behind the green centre along the line of play
  const high = maxR + 4, low = Math.min(ballU, -maxR) - 4;
  const TOP = 34, BOTTOM = H - 34;
  const s = Math.min((H * 0.62) / (2 * maxR), (BOTTOM - TOP) / (high - low)); // px per yard
  const CY = (TOP + BOTTOM) / 2 + ((high + low) / 2) * s; // centre the span green-edge → ball
  const projectView = (q: Pt) => ({ x: CX + q.v * s, y: CY - q.u * s, s });
  const project = (p: Pt) => projectView(toView(p));
  const unproject = (x: number, y: number): Pt => { const vu = (CY - y) / s, vv = (x - CX) / s; return { u: green.c.u + vu * fu + vv * ru, v: green.c.v + vu * fv + vv * rv }; };
  return { toView, project, projectView, unproject, near: -1e9, horizon: -1e9, overhead: true, scale: s };
}
/** The whole hole from above, tee at the bottom and the green at the top. */
/** Picture height for the whole-hole preset: portrait, like a yardage book page. */
const H_HOLE = 520;
function wholeHoleView(hole: HoleShape): View {
  const g = hole.green.c;
  const L = Math.hypot(g.u, g.v) || 1;
  const fu = g.u / L, fv = g.v / L, ru = -fv, rv = fu; // up the screen = tee → green centre
  const toView = (p: Pt): Pt => ({ u: p.u * fu + p.v * fv, v: p.u * ru + p.v * rv });
  const TOP = 96, BOTTOM = H_HOLE - 28; // below the hole label and camera chips
  const low = -12, high = L + Math.max(hole.green.ru, hole.green.rv) + 8;
  const s = Math.min((BOTTOM - TOP) / (high - low), 1.6);
  const CY = BOTTOM + low * s;
  const projectView = (q: Pt) => ({ x: CX + q.v * s, y: CY - q.u * s, s });
  const project = (p: Pt) => projectView(toView(p));
  const unproject = (x: number, y: number): Pt => { const vu = (CY - y) / s, vv = (x - CX) / s; return { u: vu * fu + vv * ru, v: vu * fv + vv * rv }; };
  return { toView, project, projectView, unproject, near: -1e9, horizon: -1e9, overhead: true, scale: s };
}
function presetView(preset: CameraPreset, camPos: Pt, hole: HoleShape): View {
  const flag = hole.green.c;
  if (preset === "hole") return wholeHoleView(hole);
  if (preset === "green") { const d0 = dist(camPos, flag); const fu = d0 > 1 ? (flag.u - camPos.u) / d0 : 1, fv = d0 > 1 ? (flag.v - camPos.v) / d0 : 0; return overheadView(camPos, hole.green, fu, fv, false); }
  return makeView(camPos, flag, hole.green);
}
/** Ease-in-out for the flyover. */
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const FLY_MS = 4200;
/** Point on the hole's centre line at `u` yards from the tee. */
function pointOnLine(hole: HoleShape, u: number): Pt {
  for (let i = 0; i < hole.line.length - 1; i++) { const a = hole.line[i], b = hole.line[i + 1]; if (u >= a.u && u <= b.u) { const f = (u - a.u) / (b.u - a.u || 1); return { u, v: a.v + (b.v - a.v) * f }; } }
  return u <= hole.line[0].u ? hole.line[0] : hole.line[hole.line.length - 1];
}
/** Camera for a flyover at progress `t` (0 at the tee, 1 over the green). */
function flyView(hole: HoleShape, t: number): View {
  return makeView(pointOnLine(hole, ease(t) * Math.max(0, hole.length - 20)), hole.green.c, hole.green);
}
const lerp = (a: Pt, b: Pt, f: number): Pt => ({ u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f });

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

/**
 * The baked satellite photo under the drawn shapes. The photo is registered to the hole frame
 * (u along the hole, v to the right). Straight down it is one affine placement; in perspective
 * the ground is a projective warp, so it is drawn as thin horizontal bands, each placed with the
 * affine that is exact at the band's middle depth (errors stay under a few pixels at the edges).
 */
function SatelliteLayer({ photo, view, id, coarse = false }: { photo: HolePhoto; view: View; id: string; /** Fewer bands while the camera is moving. */ coarse?: boolean }) {
  const wU = photo.u1 - photo.u0, hV = photo.v1 - photo.v0;
  // image user units are yards: x = u - u0, y = v - v0
  const corner = (x: number, y: number) => view.project({ u: photo.u0 + x, v: photo.v0 + y });
  const matrixFrom = (P0: { x: number; y: number }, P1: { x: number; y: number }, P2: { x: number; y: number }) =>
    `matrix(${(P1.x - P0.x).toFixed(5)} ${(P1.y - P0.y).toFixed(5)} ${(P2.x - P0.x).toFixed(5)} ${(P2.y - P0.y).toFixed(5)} ${P0.x.toFixed(2)} ${P0.y.toFixed(2)})`;
  if (view.overhead) {
    return <image href={photo.src} x={0} y={0} width={wU} height={hV} preserveAspectRatio="none" transform={matrixFrom(corner(0, 0), corner(1, 0), corner(0, 1))} data-testid="satellite" />;
  }
  // Perspective: bands of constant screen height from the top of the frame down to the bottom.
  const BAND = coarse ? 10 : 5;
  const bands: { y0: number; y1: number; m: string }[] = [];
  for (let y0 = 0; y0 < H; y0 += BAND) {
    const y1 = Math.min(H, y0 + BAND), ym = (y0 + y1) / 2;
    const mid = view.unproject(CX, ym); // world point at the band's middle depth on the centre line
    const q = view.toView(mid);
    if (q.u < view.near) break;
    // local affine: lateral scale at this depth, vertical scale from the depth gradient across the band
    const a = view.unproject(CX, y0), b = view.unproject(CX, y1);
    const qa = view.toView(a), qb = view.toView(b);
    const du = qa.u - qb.u || 1e-6; // view-depth span of the band (far minus near)
    const pxPerU = (y1 - y0) / du; // screen px per yard of depth (negative direction: farther = higher)
    // lateral scale from the band's NEAR edge (its largest): the strip then always covers the true
    // photo region, and the exact outline clip below trims the slight overshoot, so no gaps show
    const s = view.projectView({ u: qb.u, v: 1 }).x - view.projectView({ u: qb.u, v: 0 }).x; // px per yard laterally
    const toScreen = (p: Pt) => { const qq = view.toView(p); return { x: CX + qq.v * s, y: ym - (qq.u - q.u) * pxPerU }; };
    const P0 = toScreen({ u: photo.u0, v: photo.v0 }), P1 = toScreen({ u: photo.u0 + 1, v: photo.v0 }), P2 = toScreen({ u: photo.u0, v: photo.v0 + 1 });
    bands.push({ y0, y1, m: matrixFrom(P0, P1, P2) });
  }
  // Clip the stack of bands to the photo's true projected outline so its edges stay straight.
  const outline = polyPath(view, [{ u: photo.u0, v: photo.v0 }, { u: photo.u1, v: photo.v0 }, { u: photo.u1, v: photo.v1 }, { u: photo.u0, v: photo.v1 }]);
  return (
    <g data-testid="satellite" clipPath={`url(#${id}-outline)`}>
      <clipPath id={`${id}-outline`}><path d={outline} /></clipPath>
      {bands.map((bd, i) => (
        <g key={i} clipPath={`url(#${id}-b${i})`}>
          <clipPath id={`${id}-b${i}`}><rect x={0} y={bd.y0 - 0.3} width={W} height={bd.y1 - bd.y0 + 0.6} /></clipPath>
          <image href={photo.src} x={0} y={0} width={wU} height={hV} preserveAspectRatio="none" transform={bd.m} />
        </g>
      ))}
    </g>
  );
}

/** Ground profile tee → green with you and the flag marked, and the climb or drop left to the green. */
function ElevationProfile({ profile, pos, flag, length }: { profile: ElevationSample[]; pos: Pt; flag: Pt; length: number }) {
  const PW = 400, PH = 40, L = 8, R = 8, T = 6, B = 6;
  const uMax = Math.max(length, flag.u + 5);
  const fts = profile.map((p) => p.ft);
  const lo = Math.min(...fts), hi = Math.max(...fts), span = Math.max(12, hi - lo);
  const X = (u: number) => L + (Math.max(0, Math.min(uMax, u)) / uMax) * (PW - L - R);
  const Y = (ft: number) => T + (1 - (ft - lo) / span) * (PH - T - B);
  const pts = profile.map((p) => `${X(p.u).toFixed(1)},${Y(p.ft).toFixed(1)}`).join(" ");
  const here = { x: X(pos.u), y: Y(elevationAt(profile, pos.u)) }, pin = { x: X(flag.u), y: Y(elevationAt(profile, flag.u)) };
  const diff = elevationAt(profile, flag.u) - elevationAt(profile, pos.u);
  const total = profile[profile.length - 1].ft - profile[0].ft;
  return (
    <div className="flex items-center gap-2" data-testid="elevation-profile">
      <svg viewBox={`0 0 ${PW} ${PH}`} className="block h-10 flex-1" role="img" aria-label={`Elevation profile: ${Math.abs(Math.round(diff))} ft ${diff >= 0 ? "uphill" : "downhill"} to the green`}>
        <polygon points={`${L},${PH - B} ${pts} ${X(profile[profile.length - 1].u).toFixed(1)},${PH - B}`} fill="#8aa66a" opacity={0.35} />
        <polyline points={pts} fill="none" stroke="#5f7f48" strokeWidth={1.5} strokeLinejoin="round" />
        <line x1={here.x} y1={here.y} x2={pin.x} y2={pin.y} stroke="#b08d3c" strokeWidth={1} strokeDasharray="3 2" />
        <circle cx={pin.x} cy={pin.y} r={3} fill="#7a1f2b" stroke="#f7f3ea" strokeWidth={1} />
        <circle cx={here.x} cy={here.y} r={3.5} fill="#1b2a41" stroke="#f7f3ea" strokeWidth={1.2} />
      </svg>
      <div className="text-[11px] leading-tight text-right whitespace-nowrap">
        <div className="font-semibold text-ink" data-testid="elevation-to-green">{Math.abs(diff) < 2 ? "level to the green" : `${Math.abs(Math.round(diff))} ft ${diff > 0 ? "uphill" : "downhill"}`}</div>
        <div className="text-muted">tee→green {total >= 0 ? "+" : "−"}{Math.abs(Math.round(total))} ft · measured</div>
      </div>
    </div>
  );
}

/** A side bet or game note pinned to this hole. */
export interface HoleNote { id: string; title: string; detail: string; tone: "brass" | "muted" | "won"; onDismiss: () => void }
/** Another player's shots on this hole, drawn in their colour. */
export interface OtherTrail { playerId: string; name: string; color: string; shots: Shot[] }
export const TRAIL_COLORS = ["#e4572e", "#3a86ff", "#ffd166", "#c77dff", "#00b4d8", "#f7f3ea", "#ff8fab", "#8ac926"];

const fmtAdj = (n: number) => (Math.abs(n) < 0.5 ? "(±0)" : `(${n > 0 ? "+" : "−"}${Math.round(Math.abs(n))})`);
const label = { fontSize: 8, fill: "#f7f3ea", fontWeight: 700, style: { paintOrder: "stroke" as const, stroke: "rgba(27,42,65,0.6)", strokeWidth: 2 } };

export function HoleView({ holeNumber, par, yardage, strokeIndex, numbers, onNumbersChange, wind, onWindChange, tracking, shots, onShot, onMoveShot, focusShot, others = [], aim, aimMode, onSetAim, onAimButton, shape, notes = [], dispersion = null, conditions, onConditionsChange, satellite = true, onSatelliteChange, flight = null }: {
  holeNumber: number; par: number; yardage: number | null; strokeIndex: number; numbers: number[]; onNumbersChange: (n: number[]) => void; wind: Wind; onWindChange: (w: Wind) => void;
  tracking: boolean; shots: Shot[]; onShot: (to: Pt) => void; onMoveShot: (id: string, to: Pt, first: boolean) => void; focusShot?: Shot | null; others?: OtherTrail[]; aim: Pt | null; aimMode: boolean; onSetAim: (p: Pt) => void; onAimButton: () => void; /** Real outlines when a course is loaded. */ shape?: HoleShape; /** Side bets riding on this hole, shown as small notices on the picture. */ notes?: HoleNote[]; /** Where the selected club tends to finish, drawn on the hole while tracking. */ dispersion?: DispersionModel | null; conditions?: Partial<Conditions>; onConditionsChange?: (patch: Partial<Conditions>) => void; /** Draw the baked satellite photo under the shapes (when the course has one). */ satellite?: boolean; onSatelliteChange?: (on: boolean) => void; /** Wind and ground for drawing where shots really land. */ flight?: FlightEnv | null;
}) {
  const [editNumbers, setEditNumbers] = useState(false);
  const [editWind, setEditWind] = useState(false);
  const hole = useMemo(() => shape ?? buildHole(holeNumber, par, yardage), [shape, holeNumber, par, yardage]);
  const cond = useMemo(() => { const c = holeConditions(holeNumber, par); const e = hole.elevation; return { ...c, bearingDeg: hole.bearingDeg ?? c.bearingDeg, elevationFt: e ? Math.round(e[e.length - 1].ft - e[0].ft) : c.elevationFt }; }, [holeNumber, par, hole.bearingDeg, hole.elevation]);
  const [tapPos, setTapPos] = useState<Pt>({ u: 0, v: 0 });
  // While tracking, "you" are wherever the last logged shot came to rest.
  const lastRest = shots.length ? shots[shots.length - 1].to : null;
  const pos = useMemo<Pt>(() => (tracking ? (lastRest ?? { u: 0, v: 0 }) : tapPos), [tracking, lastRest, tapPos]);
  const flag = hole.green.c;
  // While a marker is being dragged the camera stays put, otherwise it would slide under the finger.
  const [frozenPos, setFrozenPos] = useState<Pt | null>(null);
  // Editing an earlier shot? Look at the hole from where that shot started so it is in frame to drag.
  const [preset, setPreset] = useState<CameraPreset>("ball");
  // Flyover: the camera rides the hole line from the tee to the green, then settles back on the ball.
  const [fly, setFly] = useState<number | null>(null); // 0 … 1 while flying
  const flyRef = useRef<number | null>(null);
  const startFly = () => {
    if (flyRef.current !== null) cancelAnimationFrame(flyRef.current);
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FLY_MS);
      setFly(t);
      if (t < 1) flyRef.current = requestAnimationFrame(step);
      else { flyRef.current = null; setFly(null); }
    };
    flyRef.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (flyRef.current !== null) cancelAnimationFrame(flyRef.current); }, []);
  const flyPos: Pt | null = fly === null ? null : pointOnLine(hole, ease(fly) * Math.max(0, hole.length - 20));
  const camPos = flyPos ?? frozenPos ?? (focusShot ? focusShot.from : pos);
  const view = flyPos ? makeView(camPos, flag, hole.green) : presetView(preset, camPos, hole); // cheap: a few closures
  const VH = !flyPos && preset === "hole" ? H_HOLE : H; // the whole-hole preset gets a portrait picture
  const surface = useMemo(() => greenSurface(holeNumber, hole.green, cond.tilt, hole.greenOutline), [holeNumber, hole.green, cond.tilt, hole.greenOutline]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ kind: "aim" | "shot" | "you"; id?: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    // React registers touch listeners as passive; block page scroll ourselves while a drag is live.
    const el = svgRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (dragRef.current || e.touches.length > 1) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);
  const d = greenDistances(pos, hole.green, hole.greenOutline);
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
  const photo = satellite && hole.photo ? hole.photo : null;
  const trees = (photo ? [] : hole.trees).filter(ahead).sort((a, b) => view.toView(b).u - view.toView(a).u);

  /** Screen point → world point on the ground, clamped to the hole corridor; null above the horizon. */
  // Pinch zoom: a scale + offset applied to the whole drawing (two fingers to zoom and pan, button to reset).
  const [zoom, setZoom] = useState({ k: 1, tx: 0, ty: 0 });
  const pinchRef = useRef<{ pts: Map<number, { x: number; y: number }>; start?: { d: number; mid: { x: number; y: number }; zoom: { k: number; tx: number; ty: number } } }>({ pts: new Map() });
  const svgXY = (clientX: number, clientY: number) => { const rect = svgRef.current!.getBoundingClientRect(); return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * VH }; };
  const clampZoom = (z: { k: number; tx: number; ty: number }) => { const k = Math.min(2.5, Math.max(1, z.k)); return { k, tx: Math.min(0, Math.max(W - W * k, z.tx)), ty: Math.min(0, Math.max(VH - VH * k, z.ty)) }; };
  const onPinchDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const pr = pinchRef.current;
    pr.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pr.pts.size === 2) {
      const [a, b] = [...pr.pts.values()].map((p) => svgXY(p.x, p.y));
      pr.start = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom };
      dragRef.current = null; setFrozenPos(null); // a second finger cancels any marker drag
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPinchMove = (e: React.PointerEvent<SVGSVGElement>): boolean => {
    const pr = pinchRef.current;
    if (!pr.pts.has(e.pointerId)) return false;
    pr.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pr.pts.size < 2 || !pr.start) return false;
    const [a, b] = [...pr.pts.values()].map((p) => svgXY(p.x, p.y));
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const k = pr.start.zoom.k * (d / pr.start.d);
    // keep the drawing point that was under the first midpoint under the current midpoint
    const px = (pr.start.mid.x - pr.start.zoom.tx) / pr.start.zoom.k, py = (pr.start.mid.y - pr.start.zoom.ty) / pr.start.zoom.k;
    setZoom(clampZoom({ k, tx: mid.x - px * k, ty: mid.y - py * k }));
    suppressClick.current = true;
    return true;
  };
  const onPinchUp = (e: React.PointerEvent<SVGSVGElement>) => { const pr = pinchRef.current; pr.pts.delete(e.pointerId); if (pr.pts.size < 2) pr.start = undefined; };
  const worldAt = (clientX: number, clientY: number): Pt | null => {
    const el = svgRef.current;
    if (!el) return null;
    const s0 = svgXY(clientX, clientY);
    const x = (s0.x - zoom.tx) / zoom.k;
    const y = (s0.y - zoom.ty) / zoom.k;
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
    if (onPinchMove(e)) return;
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
    onPinchUp(e);
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
  const hazards = hazardDistances(pos, flag, hole).slice(0, 3);
  const fallScreen = (() => { const a = view.project(flag), b = view.project({ u: flag.u + cond.tilt.u * 5, v: flag.v + cond.tilt.v * 5 }); return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90; })();
  const day: Conditions = { ...DEFAULT_CONDITIONS, ...(conditions ?? {}) };
  const pl = playsLike(pos, flag, hole.length, cond, wind, day, hole.elevation);
  // Wind arrow relative to the view: 0° = up the screen (the direction you're facing).
  const shotBearing = pl.shotBearingDeg;
  const windRel = ((wind.fromDeg + 180 - shotBearing) % 360 + 360) % 360;
  const layups = numbers.map((n) => ({ n, lp: layupPoint(pos, flag, n) })).filter((l) => l.lp && l.lp.distance >= 30).map(({ n, lp }) => ({ n, ...lp })).map((l) => {
    const lp = l as { n: number; point: Pt; distance: number };
    // what the lay-up itself plays like (wind + slope along that line), and what the leave plays like from there
    return { ...lp, plays: Math.round(playsLike(pos, lp.point, hole.length, cond, wind, day, hole.elevation).playsLike), leavePlays: Math.round(playsLike(lp.point, flag, hole.length, cond, wind, day, hole.elevation).playsLike) };
  });
  const aimPt = aim ? view.project(aim) : null;
  const aimDist = aim ? dist(pos, aim) : null;

  return (
    <div className="card overflow-hidden !p-0" data-testid="hole-view">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${VH}`} className={`block w-full h-auto select-none ${aimMode ? "cursor-cell" : "cursor-crosshair"}`} onClick={onTap} onPointerDown={onPinchDown} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag} ref={svgRef} style={{ touchAction: "pan-y" }} role="img" aria-label={`Hole ${holeNumber} view from your position`}>
          <defs>
            <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8aa66a" /><stop offset="100%" stopColor="#5f7f48" /></linearGradient>
            <linearGradient id="fw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a3c276" /><stop offset="100%" stopColor="#8fb463" /></linearGradient>
          </defs>
          <g transform={`translate(${zoom.tx} ${zoom.ty}) scale(${zoom.k})`} data-testid="zoom-layer">
          <rect width={W} height={VH} fill="url(#ground)" />
          {photo && <SatelliteLayer photo={photo} view={view} id={`sat-${holeNumber}`} coarse={fly !== null} />}
          {waterOutlines(hole).map((w, i) => <path key={`w${i}`} d={polyPath(view, w)} fill="#6d9fc4" fillOpacity={photo ? 0.35 : 1} stroke="#4d7fa6" strokeWidth={1} />)}
          {fairwayOutlines(hole).map((f, i) => <path key={`f${i}`} d={polyPath(view, f)} fill="url(#fw)" fillOpacity={photo ? 0.18 : 1} stroke="#86ab5c" strokeWidth={0.8} strokeOpacity={photo ? 0.7 : 1} />)}
          {bunkerOutlines(hole).map((b, i) => <path key={i} d={polyPath(view, b)} fill="#e8dcb0" fillOpacity={photo ? 0.25 : 1} stroke="#cbbb84" strokeWidth={0.8} />)}
          {!hole.real && <path d={polyPath(view, ellipsePath({ ...hole.green, ru: hole.green.ru + 5, rv: hole.green.rv + 5 }, 36))} fill="#9cc873" opacity={0.7} />}
          <path d={polyPath(view, greenOutline(hole))} fill="#b3dc8c" fillOpacity={photo ? 0.3 : 1} stroke="#79a95a" strokeWidth={1} />
          {/* putting-surface slopes: colour by grade, arrows point downhill (overhead view) */}
          <defs><clipPath id={`green-clip-${holeNumber}`}><path d={polyPath(view, greenOutline(hole))} /></clipPath></defs>
          <g clipPath={`url(#green-clip-${holeNumber})`} opacity={view.overhead ? 0.95 : 0.8}>
            {surface.cells.map((c, i) => { const h = c.half * 1.04; return <path key={i} d={polyPath(view, [{ u: c.c.u - h, v: c.c.v - h }, { u: c.c.u + h, v: c.c.v - h }, { u: c.c.u + h, v: c.c.v + h }, { u: c.c.u - h, v: c.c.v + h }])} fill={slopeColor(c.pct)} />; })}
          </g>
          {/* downhill arrows: dense straight down over the green, sparse on the approach, none from far out */}
          {surface.arrows.filter((_, i) => (view.overhead ? (view.scale ?? 0) >= 2.5 : dist(pos, flag) <= 130 && i % 4 === 0)).map((c, i) => {
            const len = (view.overhead ? 2.2 : 3.6) * Math.min(1, c.pct / 3);
            const a = view.project(c.c), b = view.project({ u: c.c.u + c.du * len, v: c.c.v + c.dv * len });
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const hd = view.overhead ? 4.2 : 5;
            const head = `M${b.x} ${b.y} L${b.x - hd * Math.cos(ang - 0.55)} ${b.y - hd * Math.sin(ang - 0.55)} L${b.x - hd * Math.cos(ang + 0.55)} ${b.y - hd * Math.sin(ang + 0.55)} Z`;
            return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f7f3ea" strokeWidth={3} strokeLinecap="round" opacity={0.8} /><path d={head} fill="#f7f3ea" stroke="#f7f3ea" strokeWidth={2} strokeLinejoin="round" opacity={0.8} /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#1b2a41" strokeWidth={1.3} strokeLinecap="round" /><path d={head} fill="#1b2a41" /></g>;
          })}
          {trees.map((t, i) => { const q = view.project(t); const r = Math.min(26, 4.5 * q.s); return <g key={i}><ellipse cx={q.x + r * 0.3} cy={q.y + r * 0.2} rx={r * 1.1} ry={r * 0.4} fill="rgba(0,0,0,0.18)" /><circle cx={q.x} cy={q.y - r * 0.6} r={r} fill="#3f6a3c" /><circle cx={q.x - r * 0.3} cy={q.y - r * 0.9} r={r * 0.55} fill="#4f7d48" /></g>; })}
          {/* tee box */}
          {!hole.real && <path d={polyPath(view, [{ u: -3, v: -7 }, { u: 5, v: -7 }, { u: 5, v: 7 }, { u: -3, v: 7 }])} fill="#b3dc8c" stroke="#79a95a" strokeWidth={0.8} />}
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
          {/* hazard yardages: a number in the hazard's colour, set off to the side with a thin leader to the edge it measures */}
          {(!view.overhead || (view.scale ?? 0) >= 1.5) && hazards.flatMap((h) => {
            const color = h.kind === "water" ? "#9fd0f0" : h.kind === "bunker" ? "#f1e2a6" : "#b7e29a";
            const out = h.side === "L" ? -1 : 1; // push labels away from the line of play
            // one number for trees, thin hazards, or anything past a full shot; front and carry when depth matters
            const twoNumbers = h.kind !== "trees" && h.carry - h.to >= 12 && h.to <= 260;
            const pts = twoNumbers ? [{ p: h.at, n: h.to, dy: 9 }, { p: h.farAt, n: h.carry, dy: -9 }] : [{ p: h.at, n: h.to, dy: 0 }];
            return pts.filter(({ p }) => ahead(p)).map(({ p, n, dy }, k) => {
              const q = view.project(p);
              let lx = q.x + out * 30, ly = q.y + dy;
              const w = String(Math.round(n)).length * 5.6;
              // keep clear of the top band (hole label, F/M/B) and the info column on the right
              if (ly < 72) ly = 72;
              const xmax = out > 0 ? lx + w : lx;
              if (ly < 134 && xmax > 254) lx -= xmax - 254;
              return (
                <g key={`${h.kind}-${h.side}-${k}`} data-testid="hazard-label">
                  <line x1={q.x} y1={q.y} x2={lx - out * 3} y2={ly} stroke={color} strokeWidth={0.8} opacity={0.9} />
                  <circle cx={q.x} cy={q.y} r={1.4} fill={color} />
                  <text x={lx} y={ly + 3} textAnchor={out < 0 ? "end" : "start"} fontSize={9} fontWeight={700} fill={color} style={{ paintOrder: "stroke", stroke: "rgba(27,42,65,0.75)", strokeWidth: 2.5 }}>{Math.round(n)}</text>
                </g>
              );
            });
          })}
          {/* logged shots, with their aim point and miss when one was set */}
          {shots.map((sh) => {
            const a = view.project(sh.from), b = view.project(sh.to);
            const am = sh.aim && ahead(sh.aim) ? view.project(sh.aim) : null;
            return (
              <g key={sh.id}>
                {ahead(sh.from) && <path d={linePath(view, sh.from, sh.to)} stroke="#b08d3c" strokeWidth={1.6} fill="none" />}
                {am && <><circle cx={am.x} cy={am.y} r={3.5} fill="none" stroke="#f7f3ea" strokeWidth={1.2} strokeDasharray="2 1.5" /><line x1={am.x} y1={am.y} x2={b.x} y2={b.y} stroke="#f7f3ea" strokeWidth={0.8} opacity={0.7} /></>}
                {ahead(sh.to) && <><circle cx={b.x} cy={b.y} r={3.2} fill="#b08d3c" stroke="#f7f3ea" strokeWidth={1} />{tracking && <circle cx={b.x} cy={b.y} r={14} fill="transparent" {...grab} onPointerDown={startDrag("shot", sh.id)} data-testid={`shot-handle-${sh.seq}`} aria-label={`Drag shot ${sh.seq}`} />}{(sh.club === "putt" ? view.overhead : Math.hypot(b.x - a.x, b.y - a.y) > 24) && <text x={(a.x + b.x) / 2 + 4} y={(a.y + b.y) / 2} {...label}>{sh.club === "putt" ? `${Math.round(dist(sh.from, flag) * 3)} ft` : `${sh.club} ${Math.round(sh.distance)}`}</text>}</>}
              </g>
            );
          })}
          {/* lay-up spots for "your numbers" */}
          {layups.map((l, i) => { const q = view.project(l.point); const left = i % 2 === 1; const underAim = !!aimPt && Math.hypot(aimPt.x - q.x, aimPt.y - q.y) < 16; return <g key={l.n}><circle cx={q.x} cy={q.y} r={4} fill="#b08d3c" stroke="#f7f3ea" strokeWidth={1.2} />{!underAim && <text x={left ? q.x - 6 : q.x + 6} y={q.y + 3} textAnchor={left ? "end" : "start"} {...label}>{l.n} in</text>}</g>; })}
          {/* personal dispersion for the selected club: 80% zone, 50% core, expected finish */}
          {dispersion && tracking && (() => {
            const target = aim ?? flag;
            // where the club's misses land in today's wind and on this ground, not in still air
            const fly = (p: Pt) => (flight ? applyFlight(flight, pos, target, p) : p);
            const outer = polyPath(view, dispersionOutline(dispersion, pos, target, 0.8, 40, !!aim).map(fly));
            const inner = polyPath(view, dispersionOutline(dispersion, pos, target, 0.5, 40, !!aim).map(fly));
            // finish zone (after roll) plus where it comes down, joined by the run-out
            const landing = fly(expectedFinish(dispersion, pos, target, !!aim));
            const touchdown = fly(expectedLanding(dispersion, pos, target, !!aim));
            const e = view.project(landing), t = view.project(touchdown);
            return (
              <g data-testid="dispersion" opacity={0.9}>
                <path d={outer} fill="#b08d3c" fillOpacity={0.22} stroke="#f7f3ea" strokeWidth={1.2} strokeDasharray="3 2" />
                <path d={inner} fill="#b08d3c" fillOpacity={0.22} stroke="#f7f3ea" strokeWidth={0.8} />
                {ahead(touchdown) && dispersion.roll >= 3 && <><line x1={t.x} y1={t.y} x2={e.x} y2={e.y} stroke="#f7f3ea" strokeWidth={1} strokeDasharray="1.5 1.5" /><circle cx={t.x} cy={t.y} r={1.8} fill="none" stroke="#f7f3ea" strokeWidth={1} data-testid="touchdown" /></>}
                {ahead(landing) && <circle cx={e.x} cy={e.y} r={2.2} fill="#f7f3ea" stroke="#b08d3c" strokeWidth={1} />}
              </g>
            );
          })()}
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
          </g>
        </svg>
        <div className="absolute left-2 top-[62px] flex items-center gap-1" data-testid="camera-presets" role="group" aria-label="Camera">
          {(["ball", "hole", "green"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={preset === p && fly === null} onClick={() => { setPreset(p); setZoom({ k: 1, tx: 0, ty: 0 }); }} className={`rounded-full px-2 py-[3px] text-[10.5px] font-semibold capitalize ${preset === p && fly === null ? "bg-[var(--bg)] text-ink" : "bg-ink/70 text-[var(--bg)]"}`} data-testid={`camera-${p}`}>{p}</button>
          ))}
          <button type="button" onClick={startFly} disabled={fly !== null} className="rounded-full pl-1.5 pr-2 py-[3px] text-[10.5px] font-semibold bg-brass text-ink flex items-center gap-0.5 disabled:opacity-70" data-testid="camera-fly" aria-label="Fly over the hole">
            <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden><path d="M6 4l14 8-14 8z" fill="currentColor" /></svg>{fly === null ? "Fly" : "Flying"}
          </button>
        </div>
        {zoom.k > 1.02 && <button type="button" onClick={() => setZoom({ k: 1, tx: 0, ty: 0 })} className="absolute left-2 top-[92px] rounded-full bg-ink/85 text-[var(--bg)] px-2.5 py-1 text-[11px] font-semibold" data-testid="zoom-reset">{zoom.k.toFixed(1)}× · reset</button>}
        <div className="absolute top-2 left-2 rounded-lg bg-ink/85 text-[var(--bg)] px-2.5 py-1.5 leading-tight">
          <div className="font-display text-xl">Hole {holeNumber}</div>
          <div className="text-[10px] uppercase tracking-wide opacity-85">Par {par}{yardage ? ` · ${yardage} yds` : ""} · SI {strokeIndex}</div>
        </div>
        <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
          <div className="flex gap-1" aria-label="Distances to green">
            {(["front", "middle", "back"] as const).map((k) => (
              <div key={k} className={`rounded-lg w-9 py-1 text-center leading-none ${k === "middle" ? "bg-[var(--bg)] text-ink" : "bg-ink/85 text-[var(--bg)]"}`}>
                <div className="text-[8px] uppercase tracking-wide opacity-80">{k[0]}</div>
                <div className="font-display text-base" data-testid={`dist-${k}`}>{Math.round(d[k])}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setEditWind((e) => !e)} className="rounded-lg bg-ink/85 text-[var(--bg)] w-[56px] py-1 flex items-center justify-center gap-1 leading-none" aria-label="Wind" data-testid="wind-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" /><g transform={`rotate(${windRel} 12 12)`}><path d="M12 4 L15.5 12 L12 10.2 L8.5 12 Z" fill="#b08d3c" /><line x1="12" y1="10" x2="12" y2="20" stroke="#b08d3c" strokeWidth="2" strokeLinecap="round" /></g></svg>
              <span className="text-[10px] font-semibold">{wind.mph}</span>
            </button>
            <div className="rounded-lg bg-ink/85 text-[var(--bg)] w-[56px] py-1 flex items-center justify-center gap-1 leading-none" aria-label={`Green falls ${tiltWords(cond.tilt)}, ${cond.tilt.pct} percent`} data-testid="slope-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" /><g transform={`rotate(${fallScreen} 12 12)`}><path d="M12 4 L15.5 12 L12 10.2 L8.5 12 Z" fill="#9cc873" /><line x1="12" y1="10" x2="12" y2="20" stroke="#9cc873" strokeWidth="2" strokeLinecap="round" /></g></svg>
              <span className="text-[10px] font-semibold">{cond.tilt.pct}%</span>
            </div>
          </div>
          <div className="rounded-lg bg-brass w-[116px] py-1 leading-none text-ink flex items-baseline justify-center gap-1.5" data-testid="plays-like">
            <span className="text-[8px] uppercase tracking-wide font-semibold">Plays like</span>
            <span className="font-display text-base">{Math.round(pl.playsLike)}</span>
          </div>
        </div>
        {!aimMode && notes.length > 0 && (
          <div className="absolute bottom-2 left-2 flex flex-col gap-1 max-w-[62%]" data-testid="hole-notes">
            {notes.map((n) => (
              <div key={n.id} className={`flex items-start gap-1.5 rounded-lg pl-2 pr-1 py-1 shadow-lg ${n.tone === "brass" ? "bg-brass text-ink" : n.tone === "won" ? "bg-[var(--bg)] text-ink" : "bg-ink/85 text-[var(--bg)]"}`} data-testid="hole-note">
                {n.tone === "won"
                  ? <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="#b08d3c" strokeWidth="2.2" className="mt-0.5 shrink-0"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 3M17 6h3a3 3 0 0 1-3 3" /></svg>
                  : <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0"><path d="M12 2l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.2 1.3-6.6L2.5 9l6.6-.8z" /></svg>}
                <div className="min-w-0 leading-tight">
                  <div className="text-[11px] font-bold truncate">{n.title}</div>
                  <div className="text-[10px] opacity-85 truncate">{n.detail}</div>
                </div>
                <button type="button" onClick={n.onDismiss} className="tap !min-h-6 !min-w-6 shrink-0 rounded-md text-base leading-none opacity-80" aria-label={`Hide ${n.title} on this hole`}>×</button>
              </div>
            ))}
          </div>
        )}
        {aimMode && <div className="absolute bottom-3 left-2 pointer-events-none"><span className="rounded-md bg-brass px-3 py-1 text-[11px] font-semibold text-ink">Tap where you&apos;re aiming</span></div>}
        <button type="button" onClick={onAimButton} aria-pressed={aimMode} data-testid="aim-fab" className={`absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full pl-2.5 pr-3 py-2 text-xs font-semibold shadow-lg ${aimMode ? "bg-brass text-ink" : aim ? "bg-[var(--bg)] text-ink" : "bg-ink/85 text-[var(--bg)]"}`} aria-label={aimMode ? "Cancel aiming" : aim ? "Move aim point" : "Set aim point"}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /><line x1="12" y1="1" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="1" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="23" y2="12" /></svg>
          {aimMode ? "Cancel" : aim ? `Aim ${Math.round(aimDist ?? 0)}` : "Aim"}
        </button>
      </div>
      <div className="px-3 py-2 border-t border-line flex flex-col gap-2">
        {hole.elevation && <ElevationProfile profile={hole.elevation} pos={pos} flag={flag} length={hole.length} />}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" data-testid="plays-like-breakdown">
          <span className="font-semibold text-ink">Plays like {Math.round(pl.playsLike)} to the middle</span>
          {pl.factors.map((f) => <span key={f.key} className="text-ink-2">{f.label} {fmtAdj(f.yards)}</span>)}
          {Math.abs(pl.crosswindMph) >= 3 && <span className="text-ink-2">{Math.round(Math.abs(pl.crosswindMph))} mph across {pl.crosswindMph > 0 ? "L→R" : "R→L"}</span>}
          <span className={`font-semibold ${pl.confidence === "high" ? "text-brass" : pl.confidence === "medium" ? "text-ink-2" : "text-muted"}`} data-testid="plays-like-confidence">{pl.confidence} confidence</span>
        </div>
        {editWind && (
          <div className="rounded-lg bg-surface-2/70 p-2 flex flex-col gap-2 text-[11px]">
            <label className="flex items-center gap-2"><span className="w-16 text-muted">Wind</span><input type="range" min={0} max={30} value={wind.mph} onChange={(e) => onWindChange({ ...wind, mph: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="Wind speed" /><span className="w-14 text-right font-semibold">{wind.mph} mph</span></label>
            <div className="flex items-center gap-2"><span className="w-16 text-muted">From</span>
              <div className="seg flex-1">{["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((n, i) => <button key={n} type="button" aria-pressed={compassName(wind.fromDeg) === n} onClick={() => onWindChange({ ...wind, fromDeg: i * 45 })} className="!min-h-8 !text-[11px]">{n}</button>)}</div>
            </div>
            <label className="flex items-center gap-2"><span className="w-16 text-muted">Temp</span><input type="range" min={35} max={105} value={day.tempF} onChange={(e) => onConditionsChange?.({ tempF: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="Temperature" /><span className="w-14 text-right font-semibold">{day.tempF}°F</span></label>
            <label className="flex items-center gap-2"><span className="w-16 text-muted">Altitude</span><input type="range" min={0} max={8000} step={250} value={day.altitudeFt} onChange={(e) => onConditionsChange?.({ altitudeFt: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="Altitude" /><span className="w-14 text-right font-semibold">{day.altitudeFt.toLocaleString()} ft</span></label>
            <div className="flex items-center gap-2"><span className="w-16 text-muted">Turf</span>
              <div className="seg flex-1">{(["soft", "normal", "firm"] as const).map((f) => <button key={f} type="button" aria-pressed={day.firmness === f} onClick={() => onConditionsChange?.({ firmness: f })} className="!min-h-8 !text-[11px]">{f}</button>)}</div>
            </div>
            <span className="text-muted">Wind from {compassName(wind.fromDeg)}, set by you ({pl.confidence} confidence: elevation is {day.elevationSource}, wind is {day.windSource === "forecast" ? "from the forecast" : "manual"}). {hole.elevation ? "Elevation is measured along this hole; the app will add the hourly forecast." : "The app will read the hourly forecast and measured elevation on the course."} Hole {holeNumber} plays toward {compassName(cond.bearingDeg)}. Green falls {tiltWords(cond.tilt)}.</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-muted">Your numbers:</span>
            {numbers.map((n) => {
              const l = layups.find((x) => x.n === n);
              return (
                <span key={n} className="inline-flex items-center gap-1 rounded-md bg-brass-soft px-2 py-1 font-semibold text-ink" data-testid="number-chip">
                  <span className="inline-block h-2 w-2 rounded-full bg-brass" />{l ? <>hit {Math.round(l.distance)}<span className="font-normal text-ink-2"> (plays {l.plays})</span> → {n} in<span className="font-normal text-ink-2"> (plays {l.leavePlays})</span></> : `${n}: pin is ${Math.round(dist(pos, flag))} out`}
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
          {atTee ? "From the tee" : `${Math.round(dist(pos, hole.tee))} yds from the tee`} · yards · Ball follows you and zooms to what&apos;s left (straight down inside 40), Hole shows the whole hole, Green looks straight down on the green, Fly flies tee to green · pinch to zoom ·{" "}
          {hole.photo && <>{photo ? `${photo.attribution} · ` : "drawn layout · "}<button type="button" className="text-accent font-semibold" onClick={() => onSatelliteChange?.(!satellite)} data-testid="satellite-toggle">{photo ? "hide satellite" : "show satellite"}</button> ·{" "}</>}
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

/** One player's shots in the replay, with how far through its flight each shot is (0 … 1). */
export interface ReplayTrail { playerId: string; name: string; color: string; shots: { shot: Shot; progress: number }[] }
/**
 * The hole picture for the round replay: a flyover camera at progress `t`, the ground and
 * satellite photo, the line of play, and every player's shots drawing in as they are "hit".
 * No controls: the replay drives it frame by frame.
 */
export function ReplayScene({ hole, holeNumber, t, trails, satellite = true }: { hole: HoleShape; holeNumber: number; t: number; trails: ReplayTrail[]; satellite?: boolean }) {
  const view = flyView(hole, t);
  const flag = hole.green.c;
  const photo = satellite && hole.photo ? hole.photo : null;
  const fl = view.project(flag);
  const ahead = (p: Pt) => view.toView(p).u > view.near + 2;
  const markers = [100, 150, 200].filter((m) => m < hole.length - 30).map((m) => ({ m, p: pointOnLine(hole, m) })).filter(({ p }) => ahead(p));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto select-none" role="img" aria-label={`Replay of hole ${holeNumber}`} data-testid="replay-scene">
      <defs>
        <linearGradient id="ground-replay" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8aa66a" /><stop offset="100%" stopColor="#5f7f48" /></linearGradient>
        <linearGradient id="fw-replay" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a3c276" /><stop offset="100%" stopColor="#8fb463" /></linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#ground-replay)" />
      {photo && <SatelliteLayer photo={photo} view={view} id={`replay-sat-${holeNumber}`} coarse />}
      {waterOutlines(hole).map((w, i) => <path key={`w${i}`} d={polyPath(view, w)} fill="#6d9fc4" fillOpacity={photo ? 0.35 : 1} stroke="#4d7fa6" strokeWidth={1} />)}
      {fairwayOutlines(hole).map((f, i) => <path key={`f${i}`} d={polyPath(view, f)} fill="url(#fw-replay)" fillOpacity={photo ? 0.18 : 1} stroke="#86ab5c" strokeWidth={0.8} strokeOpacity={photo ? 0.7 : 1} />)}
      {bunkerOutlines(hole).map((b, i) => <path key={i} d={polyPath(view, b)} fill="#e8dcb0" fillOpacity={photo ? 0.25 : 1} stroke="#cbbb84" strokeWidth={0.8} />)}
      <path d={polyPath(view, greenOutline(hole))} fill="#b3dc8c" fillOpacity={photo ? 0.3 : 1} stroke="#79a95a" strokeWidth={1} />
      <path d={linePath(view, { u: 0, v: 0 }, flag)} stroke="#f7f3ea" strokeWidth={1.2} strokeDasharray="4 3" fill="none" opacity={0.7} />
      {markers.map(({ m, p }) => { const q = view.project(p); return <g key={m}><circle cx={q.x} cy={q.y} r={2.2} fill="#f7f3ea" /><text x={q.x + 5} y={q.y + 3} {...label}>{m}</text></g>; })}
      <line x1={fl.x} y1={fl.y} x2={fl.x} y2={fl.y - 22 * Math.min(1, fl.s * 3)} stroke="#f7f3ea" strokeWidth={1.3} />
      <path d={`M${fl.x} ${fl.y - 22 * Math.min(1, fl.s * 3)} l8 3.5 l-8 3.5 z`} fill="#7a1f2b" />
      {trails.map((tr) => tr.shots.map(({ shot, progress }, i) => {
        if (progress <= 0) return null;
        const end = lerp(shot.from, shot.to, progress);
        const landed = progress >= 1;
        const isLast = landed && (i === tr.shots.length - 1 || tr.shots[i + 1].progress <= 0);
        const b = view.project(end);
        return (
          <g key={shot.id} data-testid={`replay-trail-${tr.playerId}`}>
            {ahead(shot.from) && <path d={linePath(view, shot.from, end)} stroke={tr.color} strokeWidth={landed ? 1.2 : 1.8} fill="none" opacity={landed ? 0.85 : 1} />}
            {ahead(end) && <circle cx={b.x} cy={b.y} r={isLast || !landed ? 4.2 : 2.4} fill={tr.color} stroke="rgba(27,42,65,0.7)" strokeWidth={0.8} />}
            {ahead(end) && isLast && <text x={b.x} y={b.y + 2.6} textAnchor="middle" fontSize={6.5} fontWeight={800} fill="#1b2a41">{tr.name[0]}</text>}
          </g>
        );
      }))}
    </svg>
  );
}
