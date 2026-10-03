// Measured elevation along each hole line from Open-Meteo (free, no key). Writes {hole: [{u, ft}]} to the given file.
import { readFileSync, writeFileSync } from "node:fs";
const [courseFile, out] = process.argv.slice(2);
const course = JSON.parse(readFileSync(courseFile, "utf8"));
const YPM = 1.09361;
const toLL = (h, p) => { const g = h.geo, mu = p.u / YPM, mv = p.v / YPM; const x = mu * g.fx + mv * g.fy, y = mu * g.fy - mv * g.fx; return { lat: g.lat + y / 110540, lon: g.lon + x / (111320 * Math.cos((g.lat * Math.PI) / 180)) }; };
const along = (line, u) => { // point on the polyline at "u" (projected along the straight tee→green axis)
  for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; if (u >= Math.min(a.u, b.u) && u <= Math.max(a.u, b.u) && a.u !== b.u) { const t = (u - a.u) / (b.u - a.u); return { u, v: a.v + (b.v - a.v) * t }; } }
  return u <= line[0].u ? line[0] : line[line.length - 1];
};
const result = {};
for (const h of Object.values(course.holes)) {
  if (!h.geo) continue;
  const us = []; for (let u = 0; u < h.length; u += 10) us.push(u); us.push(Math.round(h.length));
  const pts = us.map((u) => toLL(h, along(h.line, u)));
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p.lat.toFixed(6)).join(",")}&longitude=${pts.map((p) => p.lon.toFixed(6)).join(",")}`;
  let json = null;
  for (let t = 0; t < 5 && !json; t++) { try { const r = await fetch(url); if (r.ok) json = await r.json(); else await new Promise((d) => setTimeout(d, 1500)); } catch { await new Promise((d) => setTimeout(d, 1500)); } }
  if (!json) { console.log(`hole ${h.holeNumber}: FAILED`); continue; }
  result[h.holeNumber] = us.map((u, i) => ({ u, ft: Math.round(json.elevation[i] * 3.28084 * 10) / 10 }));
  const e = result[h.holeNumber]; console.log(`hole ${h.holeNumber}: tee ${e[0].ft} ft → green ${e[e.length - 1].ft} ft (${(e[e.length - 1].ft - e[0].ft).toFixed(0)} ft)`);
}
writeFileSync(out, JSON.stringify(result));
