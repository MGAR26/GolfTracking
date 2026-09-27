import path from "node:path";
import { mkdirSync } from "node:fs";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

interface DbGlobal {
  __golfDbPromise?: Promise<Db>;
}
const g = globalThis as unknown as DbGlobal;

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Hosted Postgres (e.g. Supabase). Same schema + migrations, different driver.
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { prepare: false, max: 5 });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db as unknown as Db;
  }
  // Local default: embedded Postgres (PGlite). Data persists under .data/pglite.
  const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Singleton across HMR reloads. Migrations run once on first access. */
export function getDb(): Promise<Db> {
  if (!g.__golfDbPromise) {
    g.__golfDbPromise = connect().catch((err) => {
      g.__golfDbPromise = undefined;
      throw err;
    });
  }
  return g.__golfDbPromise;
}

export { schema };
