/**
 * Hole geometry for the hole view. Units are yards in a local frame: `u` runs from the
 * tee (0) toward the green, `v` is lateral (negative = left). In the real app these
 * shapes come from OpenStreetMap polygons or organizer-placed pins, reprojected into
 * the same frame; here they are generated deterministically from the hole card so the
 * prototype has something realistic to draw.
 */
export interface Pt { u: number; v: number }
export interface Ellipse { c: Pt; ru: number; rv: number; rot: number }
export interface HoleShape {
  holeNumber: number;
  par: number;
  length: number;
  tee: Pt;
  /** Centerline waypoints (tee → landing zone → green). */
  line: Pt[];
  fairway: Pt[];
  green: Ellipse;
  bunkers: Ellipse[];
  water: Pt[] | null;
  trees: Pt[];
}

function seeded(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function ellipsePoint(e: Ellipse, t: number): Pt {
  const cos = Math.cos(e.rot), sin = Math.sin(e.rot);
  const x = e.ru * Math.cos(t), y = e.rv * Math.sin(t);
  return { u: e.c.u + x * cos - y * sin, v: e.c.v + x * sin + y * cos };
}
export function ellipsePath(e: Ellipse, steps = 28): Pt[] {
  return Array.from({ length: steps }, (_, i) => ellipsePoint(e, (i / steps) * Math.PI * 2));
}

/** Smooth polyline through the centerline with a given half-width on each side. */
function corridor(line: Pt[], halfWidth: (t: number) => number, samples = 24): Pt[] {
  const left: Pt[] = [], right: Pt[] = [];
  const total = line.length - 1;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * total;
    const k = Math.min(Math.floor(t), total - 1);
    const f = t - k;
    const a = line[k], b = line[k + 1];
    const p = { u: a.u + (b.u - a.u) * f, v: a.v + (b.v - a.v) * f };
    const du = b.u - a.u, dv = b.v - a.v;
    const len = Math.hypot(du, dv) || 1;
    const nu = -dv / len, nv = du / len;
    const w = halfWidth(i / samples);
    left.push({ u: p.u + nu * w, v: p.v + nv * w });
    right.push({ u: p.u - nu * w, v: p.v - nv * w });
  }
  return [...left, ...right.reverse()];
}

export function buildHole(holeNumber: number, par: number, yardage: number | null): HoleShape {
  const rnd = seeded(holeNumber * 7 + par * 3);
  const length = yardage ?? (par === 3 ? 170 : par === 4 ? 410 : 540);
  const dog = par === 3 ? 0 : (rnd() - 0.5) * (par === 5 ? 90 : 60);
  const bend = par === 3 ? 1 : 0.55 + rnd() * 0.15;
  const tee = { u: 0, v: 0 };
  const greenC = { u: length, v: dog };
  const line: Pt[] = par === 3 ? [tee, greenC] : [tee, { u: length * bend, v: dog * 0.35 }, greenC];
  const green: Ellipse = { c: greenC, ru: 14 + rnd() * 6, rv: 12 + rnd() * 5, rot: (rnd() - 0.5) * 0.8 };
  const fairway = par === 3 ? [] : corridor(line, (t) => (t < 0.35 ? 10 + t * 40 : t > 0.9 ? 20 - (t - 0.9) * 80 : 22 + Math.sin(t * 6) * 4));
  const bunkers: Ellipse[] = [];
  const nb = par === 3 ? 2 : 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nb; i++) {
    const side = rnd() > 0.5 ? 1 : -1;
    const greenside = i < 2;
    const u = greenside ? length - 8 + rnd() * 10 : length * (0.5 + rnd() * 0.2);
    const v = (greenside ? dog + side * (18 + rnd() * 6) : dog * 0.4 + side * (26 + rnd() * 6));
    bunkers.push({ c: { u, v }, ru: 5 + rnd() * 5, rv: 3 + rnd() * 3, rot: rnd() * Math.PI });
  }
  const water = holeNumber % 5 === 3 || (par === 3 && holeNumber % 4 === 2)
    ? [{ u: length * 0.55, v: -dog * 0.2 - 60 }, { u: length * 0.75, v: -dog * 0.2 - 30 }, { u: length * 0.95, v: dog - 45 }, { u: length * 0.9, v: dog - 70 }, { u: length * 0.5, v: -90 }]
    : null;
  const trees: Pt[] = [];
  for (let i = 0; i < 26; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const u = 20 + rnd() * (length - 10);
    const v = side * (44 + rnd() * 30) + dog * (u / length);
    if (!water || side > 0) trees.push({ u, v });
  }
  return { holeNumber, par, length, tee, line, fairway, green, bunkers, water, trees };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

/**
 * Front / middle / back of the green from a position: intersect the ray to the green's
 * center with the green outline. The same function works on any outline polygon, which is
 * what OpenStreetMap greens are.
 */
export function greenDistances(from: Pt, green: Ellipse): { front: number; middle: number; back: number } {
  const outline = ellipsePath(green, 72);
  const middle = dist(from, green.c);
  const dir = { u: (green.c.u - from.u) / middle, v: (green.c.v - from.v) / middle };
  let front = Infinity, back = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const hit = raySegment(from, dir, a, b);
    if (hit !== null) { front = Math.min(front, hit); back = Math.max(back, hit); }
  }
  if (!Number.isFinite(front)) return { front: middle, middle, back: middle };
  return { front, middle, back };
}

function raySegment(o: Pt, d: Pt, a: Pt, b: Pt): number | null {
  const eu = b.u - a.u, ev = b.v - a.v;
  const denom = d.u * ev - d.v * eu;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.u - o.u) * ev - (a.v - o.v) * eu) / denom;
  const s = ((a.u - o.u) * d.v - (a.v - o.v) * d.u) / denom;
  return t >= 0 && s >= 0 && s <= 1 ? t : null;
}

export function toPath(pts: Pt[], close = true): string {
  if (pts.length === 0) return "";
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.v.toFixed(1)} ${(-p.u).toFixed(1)}`).join(" ") + (close ? " Z" : "");
}

/* ---------- hazards and lay-ups ---------- */
export interface HazardDistance { kind: "bunker" | "water" | "trees"; side: "L" | "R" | "C"; to: number; carry: number }

function sideOf(from: Pt, toward: Pt, p: Pt): "L" | "R" | "C" {
  const cross = (toward.u - from.u) * (p.v - from.v) - (toward.v - from.v) * (p.u - from.u);
  // Frame is u forward, v to the right when looking from the tee (screen x grows with v).
  return Math.abs(cross) < 1e-6 ? "C" : cross > 0 ? "R" : "L";
}

/**
 * Distances to hazards that are in play: ahead of the player and within a cone around the
 * line to the flag. "to" is the near edge, "carry" the far edge, the way a caddie calls it.
 */
export function hazardDistances(from: Pt, flag: Pt, hole: HoleShape, coneDeg = 28): HazardDistance[] {
  const total = dist(from, flag);
  const dir = { u: (flag.u - from.u) / total, v: (flag.v - from.v) / total };
  const cos = Math.cos((coneDeg * Math.PI) / 180);
  const consider = (kind: HazardDistance["kind"], outline: Pt[]): HazardDistance | null => {
    let to = Infinity, carry = 0, inCone = false;
    const centroid = outline.reduce((a, p) => ({ u: a.u + p.u / outline.length, v: a.v + p.v / outline.length }), { u: 0, v: 0 });
    for (const p of outline) {
      const d = dist(from, p);
      if (d < 5) continue;
      const along = ((p.u - from.u) * dir.u + (p.v - from.v) * dir.v) / d;
      if (along > cos) inCone = true;
      to = Math.min(to, d);
      carry = Math.max(carry, d);
    }
    if (!inCone || to > total + 10) return null;
    return { kind, side: sideOf(from, flag, centroid), to, carry };
  };
  const out: HazardDistance[] = [];
  for (const b of hole.bunkers) { const h = consider("bunker", ellipsePath(b, 20)); if (h) out.push(h); }
  if (hole.water) { const h = consider("water", hole.water); if (h) out.push(h); }
  // Tree clusters: group trees by side and report the nearest edge of the line of trees ahead.
  for (const side of ["L", "R"] as const) {
    const pts = hole.trees.filter((t) => sideOf(from, flag, t) === side && (t.u - from.u) * dir.u + (t.v - from.v) * dir.v > 20);
    if (pts.length < 3) continue;
    const h = consider("trees", pts.map((t) => ({ u: t.u, v: t.v })));
    if (h) out.push({ ...h, side });
  }
  return out.sort((a, b) => a.to - b.to);
}

/** Where to land to leave exactly `n` yards to the flag, along the line from `from`. */
export function layupPoint(from: Pt, flag: Pt, n: number): { point: Pt; distance: number } | null {
  const total = dist(from, flag);
  if (total <= n + 5) return null;
  const t = (total - n) / total;
  return { point: { u: from.u + (flag.u - from.u) * t, v: from.v + (flag.v - from.v) * t }, distance: total - n };
}

/* ---------- conditions: elevation, wind, green tilt ---------- */
export interface HoleConditions {
  /** Compass bearing from tee to green, degrees clockwise from north. */
  bearingDeg: number;
  /** Green elevation minus tee elevation, in feet. */
  elevationFt: number;
  /** Fall line of the green in the hole frame (unit vector) and grade in percent. */
  tilt: { u: number; v: number; pct: number };
}
export interface Wind { mph: number; fromDeg: number }

/** Deterministic stand-in for terrain + weather data; the real app reads lidar/terrain tiles and a forecast. */
export function holeConditions(holeNumber: number, par: number): HoleConditions {
  const rnd = seeded(holeNumber * 31 + par * 5);
  const bearingDeg = Math.round(rnd() * 360);
  const elevationFt = Math.round((rnd() - 0.45) * 60);
  const a = rnd() * Math.PI * 2;
  // Most greens fall back-to-front (toward the player), so bias the direction that way.
  const u = -Math.abs(Math.cos(a)) * 0.8 + (rnd() - 0.5) * 0.3;
  const v = Math.sin(a);
  const len = Math.hypot(u, v) || 1;
  return { bearingDeg, elevationFt, tilt: { u: u / len, v: v / len, pct: Math.round((1 + rnd() * 3) * 10) / 10 } };
}

export function compassName(deg: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export interface PlaysLike {
  distance: number;
  elevationRemainingFt: number;
  elevationAdj: number;
  headwindMph: number;
  crosswindMph: number;
  windAdj: number;
  playsLike: number;
  shotBearingDeg: number;
}

/**
 * Caddie arithmetic, deliberately simple and explainable:
 *  - elevation: 1 yard per 3 feet of rise or fall between here and the green;
 *  - wind: a headwind adds 1% of the shot per mph, a tailwind takes off 0.5% per mph.
 */
export function playsLike(from: Pt, flag: Pt, holeLength: number, cond: HoleConditions, wind: Wind): PlaysLike {
  const distance = dist(from, flag);
  const elevAt = (u: number) => (cond.elevationFt * Math.max(0, Math.min(holeLength, u))) / holeLength;
  const elevationRemainingFt = cond.elevationFt - elevAt(from.u);
  const elevationAdj = elevationRemainingFt / 3;
  // Shot direction relative to the hole axis, then to compass.
  const rel = (Math.atan2(flag.v - from.v, flag.u - from.u) * 180) / Math.PI;
  const shotBearingDeg = (((cond.bearingDeg + rel) % 360) + 360) % 360;
  const windToDeg = (cond.bearingDeg * 0 + wind.fromDeg + 180) % 360;
  const diff = ((shotBearingDeg - windToDeg + 540) % 360) - 180; // 0 = wind blowing with the shot
  const along = Math.cos((diff * Math.PI) / 180) * wind.mph; // + tailwind, - headwind
  const headwindMph = -along;
  const crosswindMph = Math.sin((diff * Math.PI) / 180) * wind.mph; // + blows to the right of the shot
  const windAdj = headwindMph > 0 ? distance * 0.01 * headwindMph : distance * 0.005 * headwindMph;
  return { distance, elevationRemainingFt, elevationAdj, headwindMph, crosswindMph, windAdj, playsLike: distance + elevationAdj + windAdj, shotBearingDeg };
}

export function tiltWords(t: { u: number; v: number }): string {
  const parts: string[] = [];
  if (Math.abs(t.u) > 0.35) parts.push(t.u < 0 ? "back-to-front" : "front-to-back");
  if (Math.abs(t.v) > 0.35) parts.push(t.v > 0 ? "left-to-right" : "right-to-left");
  return parts.join(", ") || "nearly flat";
}
