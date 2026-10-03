// Merge measured elevation + baked photo metadata into a bundled course JSON.
import { readFileSync, writeFileSync } from "node:fs";
const [courseFile, elevFile, photosFile] = process.argv.slice(2);
const course = JSON.parse(readFileSync(courseFile, "utf8"));
const elev = elevFile ? JSON.parse(readFileSync(elevFile, "utf8")) : {};
const photos = photosFile ? JSON.parse(readFileSync(photosFile, "utf8")) : {};
for (const [n, h] of Object.entries(course.holes)) {
  if (elev[n]) h.elevation = elev[n];
  if (photos[n]) h.photo = photos[n];
}
writeFileSync(courseFile, JSON.stringify(course));
console.log(Object.values(course.holes).filter((h) => h.elevation).length, "holes with elevation,", Object.values(course.holes).filter((h) => h.photo).length, "with photos");
