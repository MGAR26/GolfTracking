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

function outlines(el: OsmElement): { lat: number; lon: number }[][] {
  if (el.type === "way") return el.geometry && el.geometry.length >= 2 ? [el.geometry] : [];
  if (el.type === "relation") return (el.members ?? []).filter((m) => m.type === "way" && m.role !== "inner" && m.geometry).map((m) => m.geometry!);
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
    const kind = tags.golf ?? (tags.natural === "water" ? "water_hazard" : "");
    if (!kind) continue;
    for (const g of outlines(el)) feats.push({ kind, ref: tags.ref, tags, pts: g.map(toXY) });
  }
  const holes: Record<number, RealHole> = {};
  for (const f of feats.filter((x) => x.kind === "hole")) {
    const num = Number((f.ref ?? f.tags.name ?? "").replace(/\D/g, ""));
    if (!num || num > 36 || f.pts.length < 2) continue;
    const start = f.pts[0], end = f.pts[f.pts.length - 1];
    const greens = feats.filter((x) => x.kind === "green").map((x) => ({ x, c: centroid(x.pts), d: 0 }));
    greens.forEach((g) => (g.d = d2(g.c, end)));
    const green = greens.sort((a, b) => a.d - b.d)[0];
    if (!green || green.d > 80) continue;
    const gc = green.c;
    // hole frame: origin at the hole's start (tee), u toward the green centre, v to the right
    const fx = gc.x - start.x, fy = gc.y - start.y, L = Math.hypot(fx, fy) || 1;
    const f0 = { x: fx / L, y: fy / L }, r0 = { x: f0.y, y: -f0.x };
    const toPt = (p: XY): Pt => ({ u: ((p.x - start.x) * f0.x + (p.y - start.y) * f0.y) * YD_PER_M, v: ((p.x - start.x) * r0.x + (p.y - start.y) * r0.y) * YD_PER_M });
    const near = (x: Feature, maxM: number) => distToPolyline(centroid(x.pts), f.pts) <= maxM || x.ref === f.ref;
    const poly = (x: Feature) => x.pts.map(toPt);
    const par = Number(f.tags.par) || null;
    holes[num] = {
      holeNumber: num,
      par,
      length: (L * YD_PER_M),
      tee: { u: 0, v: 0 },
      line: f.pts.map(toPt),
      green: poly(green.x),
      fairways: feats.filter((x) => x.kind === "fairway" && near(x, 45)).map(poly),
      bunkers: feats.filter((x) => x.kind === "bunker" && (near(x, 60) || d2(centroid(x.pts), gc) < 50)).map(poly),
      water: feats.filter((x) => x.kind === "water_hazard" || x.kind === "lateral_water_hazard").filter((x) => near(x, 120)).map(poly),
      trees: treeNodes.filter((t) => distToPolyline(t, f.pts) < 90).map(toPt),
      bearingDeg: ((Math.atan2(f0.x, f0.y) * 180) / Math.PI + 360) % 360,
    };
  }
  return { name, source: "osm", fetchedAt: new Date().toISOString(), holes };
}
