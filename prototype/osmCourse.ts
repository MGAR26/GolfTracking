/**
 * Real course geometry from OpenStreetMap. Mappers tag golf features (golf=hole/tee/fairway/
 * green/bunker/water_hazard) on many courses; Overpass returns them with coordinates. Each hole
 * is re-projected into the hole frame the renderer already uses: yards, u from the tee toward
 * the green, v to the right of that line.
 */
import type { Pt } from "./holeGeometry";

export interface RealHole {
  holeNumber: number;
  par: number | null;
  /** Straight-line yards from tee to green centre. */
  length: number;
  tee: Pt;
  line: Pt[];
  green: Pt[];
  fairways: Pt[][];
  bunkers: Pt[][];
  water: Pt[][];
  trees: Pt[];
  /** Compass bearing tee → green, degrees clockwise from north (for wind). */
  bearingDeg: number;
  /** Where the hole frame sits on the earth: the frame origin (tee end of the hole line) and the
   *  unit forward vector in metres east/north, so any lat/lon maps to (u, v) yards and back. */
  geo?: { lat: number; lon: number; fx: number; fy: number };
  /** Measured ground height along the line, feet above sea level at u yards from the tee. */
  elevation?: { u: number; ft: number }[];
  /** Pre-rendered satellite photo registered to the frame: covers u0…u1 by v0…v1 yards. */
  photo?: { src: string; u0: number; u1: number; v0: number; v1: number; attribution: string };
}
export const YARDS_PER_METER = 1.09361;
/** Frame (u, v) yards → lat/lon, using the hole's geo registration. */
export function frameToLatLon(h: RealHole, p: Pt): { lat: number; lon: number } {
  const g = h.geo!;
  const mu = p.u / YARDS_PER_METER, mv = p.v / YARDS_PER_METER;
  const x = mu * g.fx + mv * g.fy, y = mu * g.fy - mv * g.fx; // v is to the right: r = (fy, -fx)
  const kx = 111320 * Math.cos((g.lat * Math.PI) / 180), ky = 110540;
  return { lat: g.lat + y / ky, lon: g.lon + x / kx };
}
export interface RealCourse { name: string; source: "osm"; fetchedAt: string; holes: Record<number, RealHole> }

interface OsmNode { type: "node"; id: number; lat: number; lon: number; tags?: Record<string, string> }
interface OsmWay { type: "way"; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; nodes?: number[] }
interface OsmRelation { type: "relation"; id: number; tags?: Record<string, string>; members?: { type: string; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[] }
export type OsmElement = OsmNode | OsmWay | OsmRelation;

const YD_PER_M = 1.09361;

export function buildOverpassQuery(courseName: string): string {
  const safe = courseName.replace(/["\\]/g, "").trim();
  return `[out:json][timeout:60];
(way["leisure"="golf_course"]["name"~"${safe}",i];relation["leisure"="golf_course"]["name"~"${safe}",i];)->.c;
.c map_to_area->.a;
(way(area.a)["golf"];relation(area.a)["golf"];node(area.a)["golf"];way(area.a)["natural"="water"];node(area.a)["natural"="tree"];);
out body geom;`;
}

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Fetch straight from the browser: Overpass is free and answers cross-origin requests. */
export async function fetchRealCourse(courseName: string): Promise<RealCourse> {
  const res = await fetch(OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(buildOverpassQuery(courseName)), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!res.ok) throw new Error(`Map server answered ${res.status}`);
  const json = (await res.json()) as { elements: OsmElement[] };
  const course = courseFromOsm(courseName, json.elements);
  if (Object.keys(course.holes).length === 0) throw new Error("No holes are mapped for that course yet");
  return course;
}

/* ---------- geometry helpers in metres (east, north) ---------- */
type XY = { x: number; y: number };
function projector(lat0: number, lon0: number) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return (p: { lat: number; lon: number }): XY => ({ x: (p.lon - lon0) * kx, y: (p.lat - lat0) * ky });
}
const centroid = (pts: XY[]): XY => pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
const d2 = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
function distToPolyline(p: XY, line: XY[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    best = Math.min(best, d2(p, { x: a.x + abx * t, y: a.y + aby * t }));
  }
  return best;
}

interface Feature { kind: string; ref?: string; tags: Record<string, string>; pts: XY[] }
function insideXY(pts: XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Points every ~10 m along a polyline. */
function sample(line: XY[], stepM = 10): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1], n = Math.max(1, Math.round(d2(a, b) / stepM)); for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }); }
  return out;
}

type LL = { lat: number; lon: number };
const same = (a: LL, b: LL) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
/** Multipolygon outer rings often arrive as several way pieces: chain them end to end into closed rings. */
function assembleRings(pieces: LL[][]): LL[][] {
  const pool = pieces.map((p) => [...p]);
  const rings: LL[][] = [];
  while (pool.length) {
    const ring = pool.shift()!;
    let grew = true;
    while (grew && !same(ring[0], ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i], tail = ring[ring.length - 1];
        if (same(p[0], tail)) { ring.push(...p.slice(1)); pool.splice(i, 1); grew = true; break; }
        if (same(p[p.length - 1], tail)) { ring.push(...p.slice(0, -1).reverse()); pool.splice(i, 1); grew = true; break; }
      }
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
function outlines(el: OsmElement): LL[][] {
  if (el.type === "way") return el.geometry && el.geometry.length >= 2 ? [el.geometry] : [];
  if (el.type === "relation") return assembleRings((el.members ?? []).filter((m) => m.type === "way" && m.role !== "inner" && m.geometry && m.geometry.length >= 2).map((m) => m.geometry!));
  return [];
}

/** Turn an Overpass answer into holes in the renderer's frame. Unmapped holes are simply absent. */
export function courseFromOsm(name: string, elements: OsmElement[]): RealCourse {
  const first = elements.find((e): e is OsmNode => e.type === "node") ?? null;
  const anyGeom = elements.flatMap(outlines).find((g) => g.length)?.[0];
  const origin = first ? { lat: first.lat, lon: first.lon } : anyGeom ?? { lat: 0, lon: 0 };
  const toXY = projector(origin.lat, origin.lon);
  const feats: Feature[] = [];
  const treeNodes: XY[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (el.type === "node") { if (tags.natural === "tree") treeNodes.push(toXY(el)); continue; }
    if (tags.natural === "wood" || tags.landuse === "forest") {
      // a wood edge reads as a row of trees: sample its outline every ~12 m
      for (const g of outlines(el)) { const pts = g.map(toXY); for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.round(d2(a, b) / 12)); for (let k = 0; k < n; k++) treeNodes.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }); } }
      continue;
    }
    const kind = tags.golf ?? (tags.natural === "water" ? "water_hazard" : "");
    if (!kind) continue;
    for (const g of outlines(el)) feats.push({ kind, ref: tags.ref, tags, pts: g.map(toXY) });
  }
  const holes: Record<number, RealHole> = {};
  for (const f of feats.filter((x) => x.kind === "hole")) {
    const num = Number(((f.ref ?? f.tags.name ?? "").match(/\d+/) ?? [])[0]);
    if (!num || num > 36 || f.pts.length < 2) continue;
    const greens = feats.filter((x) => x.kind === "green").map((x) => ({ x, c: centroid(x.pts) }));
    if (greens.length === 0) continue;
    const nearestGreen = (p: XY) => greens.reduce((best, g) => (d2(g.c, p) < d2(best.c, p) ? g : best));
    // Some hole lines are drawn green → tee: orient so the end is the end nearer a green.
    let pts = f.pts;
    if (d2(nearestGreen(pts[0]).c, pts[0]) < d2(nearestGreen(pts[pts.length - 1]).c, pts[pts.length - 1])) pts = [...pts].reverse();
    const start = pts[0], end = pts[pts.length - 1];
    const green = nearestGreen(end);
    if (d2(green.c, end) > 80) continue;
    const gc = green.c;
    f.pts = pts;
    // hole frame: origin at the hole's start (tee), u toward the green centre, v to the right
    const fx = gc.x - start.x, fy = gc.y - start.y, L = Math.hypot(fx, fy) || 1;
    const f0 = { x: fx / L, y: fy / L }, r0 = { x: f0.y, y: -f0.x };
    const toPt = (p: XY): Pt => ({ u: ((p.x - start.x) * f0.x + (p.y - start.y) * f0.y) * YD_PER_M, v: ((p.x - start.x) * r0.x + (p.y - start.y) * r0.y) * YD_PER_M });
    // a feature belongs to the hole if any of its outline sits close to the hole line (doglegs put centroids far off)
    const samples = sample(pts);
    const near = (x: Feature, maxM: number) => x.ref === f.ref || x.pts.some((p) => distToPolyline(p, f.pts) <= maxM) || samples.some((p) => insideXY(x.pts, p));
    const nearGreen = (x: Feature, maxM: number) => x.pts.some((p) => d2(p, gc) <= maxM);
    const poly = (x: Feature) => x.pts.map(toPt);
    const lengthYd = L * YD_PER_M;
    const par = Number(f.tags.par) || (lengthYd <= 245 ? 3 : lengthYd <= 490 ? 4 : 5);
    holes[num] = {
      holeNumber: num,
      par,
      length: lengthYd,
      tee: { u: 0, v: 0 },
      line: f.pts.map(toPt),
      green: poly(green.x),
      fairways: feats.filter((x) => x.kind === "fairway" && near(x, 25)).map(poly),
      bunkers: feats.filter((x) => x.kind === "bunker" && (near(x, 40) || nearGreen(x, 40))).map(poly),
      water: feats.filter((x) => x.kind === "water_hazard" || x.kind === "lateral_water_hazard").filter((x) => near(x, 90)).map(poly),
      trees: treeNodes.filter((t) => distToPolyline(t, f.pts) < 90).map(toPt),
      bearingDeg: ((Math.atan2(f0.x, f0.y) * 180) / Math.PI + 360) % 360,
      geo: { lat: origin.lat + start.y / 110540, lon: origin.lon + start.x / (111320 * Math.cos((origin.lat * Math.PI) / 180)), fx: f0.x, fy: f0.y },
    };
  }
  return { name, source: "osm", fetchedAt: new Date().toISOString(), holes };
}
