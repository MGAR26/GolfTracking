import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState, LinkButton, Page, Pill } from "@/components/ui";
import { listTrips } from "@/server/services/tripService";
import { formatDateRange, plural } from "@/lib/format";
import { loadDemoTripAction } from "./actions/trips";

export default async function HomePage() {
  const trips = await listTrips();
  return (
    <>
      <AppHeader title="Golf Trip OS" subtitle="Trips" />
      <Page>
        {trips.length === 0 ? (
          <EmptyState title="No trips yet" body="Create a trip, add your group and handicaps, then start scoring.">
            <LinkButton href="/trips/new">New trip</LinkButton>
            <form action={loadDemoTripAction}>
              <button type="submit" className="btn btn-ghost text-sm">Load demo trip (Pinehurst 2026)</button>
            </form>
          </EmptyState>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {trips.map((t) => (
                <li key={t.id}>
                  <Link href={`/trips/${t.id}`} className="card block p-4 active:scale-[0.99] transition-transform">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="font-display text-xl leading-tight truncate">{t.name}</h2>
                        <p className="text-sm text-muted mt-0.5">
                          {[t.destination, formatDateRange(t.startDate, t.endDate)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {t.liveRoundId && <Pill tone="green">Live</Pill>}
                    </div>
                    <p className="text-xs text-ink-2 mt-2">{plural(t.playerCount, "player")} · {plural(t.roundCount, "round")}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <LinkButton href="/trips/new" variant="secondary">New trip</LinkButton>
          </>
        )}
      </Page>
    </>
  );
}
