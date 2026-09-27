import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Card, LinkButton, Page, Pill, ToPar } from "@/components/ui";
import { getTripDashboard } from "@/server/services/tripService";
import { getActor } from "@/server/actor";
import { formatDateRange, formatTime, money } from "@/lib/format";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const d = await getTripDashboard(tripId);
  if (!d) notFound();
  const actor = await getActor();
  const me = d.standings.find((s) => s.playerId === actor?.playerId);
  const anyCounted = d.standings.some((s) => s.roundsCounted > 0);
  const primaryRound = d.liveRound ?? d.nextRound;
  const lastLocked = [...d.rounds].reverse().find((r) => r.status === "LOCKED");
  const lastRecap = lastLocked ? d.recaps.find((r) => r.roundId === lastLocked.id) : null;

  return (
    <>
      <AppHeader title={d.trip.name} back="/" subtitle={[d.trip.destination, formatDateRange(d.trip.startDate, d.trip.endDate)].filter(Boolean).join(" · ")} />
      <Page>
        {primaryRound ? (
          <Card className="!bg-green !border-green text-white">
            <p className="text-xs uppercase tracking-wide opacity-80">{primaryRound.status === "LIVE" ? "Live now" : "Up next"}</p>
            <h2 className="font-display text-2xl mt-1">{primaryRound.name ?? d.rounds.find((r) => r.id === primaryRound.id)?.courseName}</h2>
            <p className="text-sm opacity-90">
              {d.rounds.find((r) => r.id === primaryRound.id)?.courseName}
              {primaryRound.startsAt ? ` · ${formatTime(primaryRound.startsAt)}` : ""}
              {!primaryRound.countsTowardTrip ? " · standalone" : ""}
            </p>
            <Link href={`/rounds/${primaryRound.id}/score`} className="btn btn-secondary w-full mt-3 !text-green-ink">
              {primaryRound.status === "LIVE" ? "Continue scoring" : "Start today's round"}
            </Link>
          </Card>
        ) : (
          <LinkButton href={`/trips/${tripId}/rounds/new`}>Add round</LinkButton>
        )}

        <Card title="Trip standings" action={<span className="text-xs text-muted">{anyCounted ? "Net · counted rounds" : "No rounds locked yet"}</span>}>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="text-left font-semibold py-1">Player</th>
                <th className="text-right font-semibold py-1">Rds</th>
                <th className="text-right font-semibold py-1">Gross</th>
                <th className="text-right font-semibold py-1">Net</th>
                <th className="text-right font-semibold py-1">Money</th>
              </tr>
            </thead>
            <tbody>
              {d.standings.map((s, i) => (
                <tr key={s.playerId} className={`border-t border-line ${s.playerId === actor?.playerId ? "bg-green-soft/50" : ""}`}>
                  <td className="py-2 font-medium">
                    <span className="text-muted mr-2">{s.roundsCounted ? i + 1 : "–"}</span>
                    {s.displayName}
                  </td>
                  <td className="py-2 text-right text-ink-2">{s.roundsCounted}</td>
                  <td className="py-2 text-right">{s.roundsCounted ? <><span className="font-semibold">{s.totalGross}</span> <ToPar value={s.grossToPar} className="text-xs" /></> : "–"}</td>
                  <td className="py-2 text-right">{s.roundsCounted ? <><span className="font-semibold">{s.totalNet}</span> <ToPar value={s.netToPar} className="text-xs" /></> : "–"}</td>
                  <td className={`py-2 text-right font-semibold ${s.moneyCents > 0 ? "text-green-ink" : s.moneyCents < 0 ? "text-red" : "text-muted"}`}>{money(s.moneyCents, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {me && (
            <p className="text-xs text-muted mt-2">
              You are {me.moneyCents === 0 ? "even" : me.moneyCents > 0 ? `up ${money(me.moneyCents)}` : `down ${money(-me.moneyCents)}`} ·{" "}
              <Link href={`/trips/${tripId}/money`} className="text-green font-semibold">Money & settlement</Link>
            </p>
          )}
        </Card>

        {lastRecap && (
          <Card title="Previous round">
            <Link href={`/rounds/${lastRecap.roundId}`} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{lastRecap.name}</p>
                <p className="text-xs text-muted">{lastRecap.leader ? `${lastRecap.leader} led on net` : "Locked"}{lastRecap.countsTowardTrip ? "" : " · standalone"}</p>
              </div>
              <span className="text-green text-sm font-semibold">Recap ›</span>
            </Link>
          </Card>
        )}

        <Card title="Rounds" action={<Link href={`/trips/${tripId}/rounds/new`} className="text-sm font-semibold text-green">+ Add</Link>}>
          {d.rounds.length === 0 ? (
            <p className="text-sm text-muted">No rounds yet. Add the first one to snapshot handicaps and pick games.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.rounds.map((r) => {
                const recap = d.recaps.find((x) => x.roundId === r.id);
                return (
                  <li key={r.id}>
                    <Link href={`/rounds/${r.id}`} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.name ?? r.courseName}</p>
                        <p className="text-xs text-muted">
                          {r.courseName} · {r.teeName}
                          {r.startsAt ? ` · ${formatTime(r.startsAt)}` : ""}
                          {recap && r.status === "LIVE" ? ` · thru ${recap.holesComplete}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!r.countsTowardTrip && <Pill>Standalone</Pill>}
                        <Pill tone={r.status === "LIVE" ? "green" : r.status === "LOCKED" ? "neutral" : "gold"}>{r.status === "LOCKED" ? "Final" : r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Pill>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Players">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {d.members.map((m) => (
              <li key={m.profile.id} className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2">
                <span className="font-medium">{m.profile.displayName}</span>
                <span className="text-xs text-ink-2">HI {m.profile.handicapIndex.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </Page>
    </>
  );
}
