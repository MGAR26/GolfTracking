import { describe, expect, it } from "vitest";
import { courseFromOsm, buildOverpassQuery, type OsmElement } from "../../prototype/osmCourse";
import { buildRealHole, greenDistances, hazardDistances, lieAt } from "../../prototype/holeGeometry";

// A par 4 running due north from (0,0): tee at the origin, green centre ~365 m (400 yd) north.
const lat0 = 35.19, lon0 = -79.47;
const m = (dxM: number, dyM: number) => ({ lat: lat0 + dyM / 110540, lon: lon0 + dxM / (111320 * Math.cos((lat0 * Math.PI) / 180)) });
const ring = (cx: number, cy: number, rx: number, ry: number, n = 12) => Array.from({ length: n + 1 }, (_, i) => m(cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)));
const elements: OsmElement[] = [
  { type: "way", id: 1, tags: { golf: "hole", ref: "7", par: "4" }, geometry: [m(0, 0), m(10, 200), m(0, 365)] },
  { type: "way", id: 2, tags: { golf: "green" }, geometry: ring(0, 365, 14, 16) },
  { type: "way", id: 3, tags: { golf: "fairway", ref: "7" }, geometry: [m(-18, 60), m(18, 60), m(20, 330), m(-20, 330), m(-18, 60)] },
  { type: "way", id: 4, tags: { golf: "bunker" }, geometry: ring(22, 360, 5, 4) },
  { type: "way", id: 5, tags: { golf: "water_hazard" }, geometry: [m(-90, 150), m(-40, 150), m(-40, 220), m(-90, 220), m(-90, 150)] },
  { type: "way", id: 6, tags: { golf: "green" }, geometry: ring(300, 900, 14, 14) }, // another hole's green, far away
  { type: "node", id: 7, lat: m(40, 200).lat, lon: m(40, 200).lon, tags: { natural: "tree" } },
];

describe("real course from OpenStreetMap", () => {
  it("builds the query around the course name", () => {
    expect(buildOverpassQuery('Pinehurst "No. 4"')).toContain('["name"~"Pinehurst No. 4",i]');
  });
  it("re-projects a hole into the tee → green frame in yards", () => {
    const course = courseFromOsm("Test", elements);
    const h = course.holes[7];
    expect(h).toBeDefined();
    expect(h.par).toBe(4);
    expect(h.length).toBeCloseTo(365 * 1.09361, 0);
    expect(h.bearingDeg).toBeCloseTo(0, 0);
    expect(h.fairways).toHaveLength(1);
    expect(h.bunkers).toHaveLength(1);
    expect(h.water).toHaveLength(1);
    expect(h.trees).toHaveLength(1);
    expect(Object.keys(course.holes)).toEqual(["7"]);
    // the bunker is right of the line (east), water left (west), tree right
    const bc = h.bunkers[0].reduce((a, p) => a + p.v, 0) / h.bunkers[0].length;
    expect(bc).toBeGreaterThan(15);
    expect(h.water[0].every((p) => p.v < 0)).toBe(true);
    expect(h.trees[0].v).toBeGreaterThan(0);
  });
  it("feeds the renderer: lies, green distances and hazards use the real outlines", () => {
    const h = courseFromOsm("Test", elements).holes[7];
    const shape = buildRealHole(h, 4);
    expect(shape.real).toBe(true);
    expect(lieAt(shape, { u: 200, v: 0 })).toBe("fairway");
    expect(lieAt(shape, { u: 200, v: -70 })).toBe("water");
    expect(lieAt(shape, { u: 394, v: 24 })).toBe("sand");
    expect(lieAt(shape, { u: 399, v: 0 })).toBe("green");
    expect(lieAt(shape, { u: 200, v: 60 })).toBe("rough");
    const d = greenDistances({ u: 0, v: 0 }, shape.green, shape.greenOutline);
    expect(d.front).toBeLessThan(d.middle);
    expect(d.back).toBeGreaterThan(d.middle);
    expect(Math.abs(d.back - d.front - 2 * 16 * 1.09361)).toBeLessThan(1.5);
    const hz = hazardDistances({ u: 0, v: 0 }, shape.green.c, shape);
    expect(hz.map((x) => x.kind)).toContain("bunker");
  });
});
