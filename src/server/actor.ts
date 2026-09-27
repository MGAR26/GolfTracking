import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@/db/client";

export const ACTOR_COOKIE = "gto_player";

export interface Actor {
  playerId: string;
  displayName: string;
}

/**
 * V1 has no auth provider wired yet. The acting player is chosen via a cookie so
 * group / individual / hybrid scoring permissions can be exercised end-to-end.
 * Swap this for Supabase Auth session lookup without touching services.
 */
export async function getActor(): Promise<Actor | null> {
  const db = await getDb();
  const jar = await cookies();
  const id = jar.get(ACTOR_COOKIE)?.value;
  if (id) {
    const [p] = await db.select().from(s.playerProfiles).where(eq(s.playerProfiles.id, id));
    if (p) return { playerId: p.id, displayName: p.displayName };
  }
  const [first] = await db.select().from(s.playerProfiles).orderBy(s.playerProfiles.createdAt).limit(1);
  return first ? { playerId: first.id, displayName: first.displayName } : null;
}

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new Error("No players exist yet");
  return a;
}
