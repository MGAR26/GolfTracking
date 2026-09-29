// Merge raw Overpass answers (one JSON per feature type) into a compact course file the prototype ships with.
// usage: node scripts/bundle-course.mjs <dir-with-*.json> "<Course name>" prototype/courses/<slug>.json
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
const [dir, name, out] = process.argv.slice(2);
const r = await build({ entryPoints: ["prototype/osmCourse.ts"], bundle: true, format: "esm", write: false, platform: "node" });
const mod = await import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
const elements = readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => { try { return JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).elements ?? []; } catch { return []; } });
const seen = new Set();
const unique = elements.filter((e) => { const k = e.type + e.id; if (seen.has(k)) return false; seen.add(k); return true; });
const course = mod.courseFromOsm(name, unique);
const round = (p) => ({ u: Math.round(p.u * 10) / 10, v: Math.round(p.v * 10) / 10 });
for (const h of Object.values(course.holes)) {
  h.length = Math.round(h.length * 10) / 10; h.bearingDeg = Math.round(h.bearingDeg);
  h.line = h.line.map(round); h.green = h.green.map(round); h.fairways = h.fairways.map((p) => p.map(round)); h.bunkers = h.bunkers.map((p) => p.map(round)); h.water = h.water.map((p) => p.map(round)); h.trees = h.trees.map(round);
}
mkdirSync(out.split("/").slice(0, -1).join("/"), { recursive: true });
writeFileSync(out, JSON.stringify(course));
const holes = Object.values(course.holes).sort((a, b) => a.holeNumber - b.holeNumber);
console.log(`${unique.length} elements → ${holes.length} holes → ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
for (const h of holes) console.log(`hole ${h.holeNumber}: par ${h.par ?? "?"} · ${Math.round(h.length)} yds · fw ${h.fairways.length} · bunkers ${h.bunkers.length} · water ${h.water.length} · trees ${h.trees.length} · bearing ${h.bearingDeg}`);
