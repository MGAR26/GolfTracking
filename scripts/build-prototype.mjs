/**
 * Builds the clickable prototype (prototype/) into prototype/dist:
 *   app.js   — React app + the real domain package, bundled by esbuild
 *   app.css  — Tailwind output for src + prototype, from the app's own globals.css tokens
 *   index.html — shell
 */
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "prototype", "dist");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "prototype", "main.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(out, "app.js"),
  logLevel: "info",
});

const css = readFileSync(path.join(root, "src", "app", "globals.css"), "utf8");
const result = await postcss([tailwind()]).process(css, { from: path.join(root, "src", "app", "globals.css"), to: path.join(out, "app.css") });
writeFileSync(path.join(out, "app.css"), result.css);

const html = readFileSync(path.join(root, "prototype", "index.html"), "utf8");
writeFileSync(path.join(out, "index.html"), html);
// Baked course imagery (satellite photos per hole) ships next to the bundle.
const courses = path.join(root, "prototype", "courses");
if (existsSync(courses)) cpSync(courses, path.join(out, "courses"), { recursive: true, filter: (src) => !src.endsWith(".json") });
console.log("prototype built →", out);
