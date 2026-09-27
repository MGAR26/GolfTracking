import { rmSync } from "node:fs";
import path from "node:path";

const dir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
