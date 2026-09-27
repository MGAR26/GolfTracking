import Link from "next/link";
import { getDb, schema as s } from "@/db/client";
import { getActor } from "@/server/actor";
import { ActorSwitcher } from "./ActorSwitcher";
import { asc } from "drizzle-orm";

export async function AppHeader({ title, back, subtitle }: { title: string; back?: string; subtitle?: string }) {
  const db = await getDb();
  const actor = await getActor();
  const profiles = await db.select({ id: s.playerProfiles.id, name: s.playerProfiles.displayName }).from(s.playerProfiles).orderBy(asc(s.playerProfiles.createdAt));
  return (
    <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-lg px-4 h-14 flex items-center gap-3">
        {back ? (
          <Link href={back} className="tap -ml-2 inline-flex items-center justify-center text-accent font-semibold" aria-label="Back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
        ) : (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[var(--bg)] font-display text-sm ring-1 ring-brass">G</span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-muted truncate">{subtitle}</p>}
        </div>
        <ActorSwitcher players={profiles} currentId={actor?.playerId ?? null} />
      </div>
    </header>
  );
}
