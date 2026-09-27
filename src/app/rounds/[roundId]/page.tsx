import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, LinkButton, Page, Pill, ToPar } from "@/components/ui";
import { Leaderboard } from "@/components/Leaderboard";
import { loadRoundSnapshot } from "@/server/services/roundProjection";
import { getActor } from "@/server/actor";
import { getTripLedger } from "@/server/services/tripService";
import { computeNetBalances } from "@/domain/ledger";
import { money } from "@/lib/format";
import { reopenRoundFormAction } from "@/app/actions/rounds";
import { listOpenConflicts } from "@/server/services/conflictService";
import { ConflictPanel } from "@/components/ConflictPanel";

export default async function RoundOverviewPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) notFound();
  const actor = await getActor();
  const me = actor ? snap.players.find((p) => p.playerId === actor.playerId) : null;
  const myTotals = me ? snap.totals[me.playerId] : null;
  const myStats = me ? snap.stats[me.playerId] : null;
  const live = snap.round.status === "LIVE";
  const hole = snap.currentHole ? snap.holes.find((h) => h.holeNumber === snap.currentHole)! : null;
  const ledger = snap.round.tripId ? await getTripLedger(snap.round.tripId) : [];
  const roundLedger = ledger.filter((e) => e.roundId === roundId);
  const balances = computeNetBalances(roundLedger, snap.players.map((p) => p.playerId));
  const canOrganize = !!me && (me.tripRole === "OWNER" || me.tripRole === "ORGANIZER");
  const conflicts = canOrganize && live ? await listOpenConflicts(roundId) : [];
  const nameOf = (id: string | null) => (id ? (snap.players.find((p) => p.playerId === id)?.displayName ?? null) : null);
  const highlights = snap.players.flatMap((p) =>
    snap.totals[p.playerId].holes.filter((h) => h.grossToPar !== null && h.grossToPar <= -1).map((h) => ({ player: p.displayName, hole: h.holeNumber, label: h.grossToPar === -1 ? "Birdie" : h.grossToPar === -2 ? "Eagle" : "Albatross" })),
  );

  return (
    <Page>
      {conflicts.length > 0 && (
        <ConflictPanel
          roundId={roundId}
          conflicts={conflicts.map((c) => ({ id: c.id, playerName: nameOf(c.playerId) ?? c.playerId, holeNumber: c.holeNumber, reporterName: c.reporterName, theirsUpdatedByName: nameOf(c.theirsUpdatedBy), mine: c.mine, theirs: c.theirs }))}
        />
      )}
      {live && hole ? (
        <Card className="!bg-ink !border-ink !border-t-brass text-[var(--bg)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide opacity-80">Now playing</p>
              <h2 className="font-display text-2xl mt-0.5">Hole {hole.holeNumber}</h2>
              <p className="text-sm opacity-90">Par {hole.par}{hole.yardage ? ` · ${hole.yardage} yds` : ""} · SI {hole.strokeIndex}</p>
            </div>
            <Link href={`/rounds/${roundId}/score?hole=${hole.holeNumber}`} className="btn btn-secondary !text-ink">Score</Link>
          </div>
          {snap.nowNotes.length > 0 && (
            <ul className="mt-3 text-sm space-y-1 border-t border-white/20 pt-2">
              {snap.nowNotes.map((n, i) => (
                <li key={i} className="flex gap-2"><span aria-hidden>•</span>{n}</li>
              ))}
            </ul>
          )}
        </Card>
      ) : live ? (
        <Card className="!bg-ink !border-ink !border-t-brass text-[var(--bg)]">
          <p className="font-display text-xl">All 18 holes scored</p>
          <p className="text-sm opacity-90 mt-1">Review the card, resolve any bets, then finish the round to lock it and post results.</p>
          <Link href={`/rounds/${roundId}/finish`} className="btn btn-secondary w-full mt-3 !text-ink">Finish round</Link>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-xl">Round locked</p>
              <p className="text-xs text-muted">Results are posted{snap.round.countsTowardTrip ? " and count toward the trip" : "; standalone round"}.</p>
            </div>
            <Pill tone="green">Final</Pill>
          </div>
          {canOrganize && (
            <form action={reopenRoundFormAction.bind(null, roundId, snap.round.tripId, "organizer correction")} className="mt-3">
              <button type="submit" className="btn btn-secondary w-full text-sm">Reopen for correction</button>
              <p className="text-[11px] text-muted mt-1">Reverses this round&apos;s posted game results with an audit trail; finishing again re-posts them.</p>
            </form>
          )}
        </Card>
      )}

      {me && myTotals && (
        <Card title={`${me.displayName} · CH ${me.courseHandicap}`} action={<Link href={`/rounds/${roundId}/stats`} className="text-xs font-semibold text-accent">Stats ›</Link>}>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Gross" value={myTotals.holesPlayed ? String(myTotals.total.gross) : "–"} sub={myTotals.holesPlayed ? <ToPar value={myTotals.total.grossToPar} /> : null} />
            <Stat label="Net" value={myTotals.holesPlayed ? String(myTotals.total.net) : "–"} sub={myTotals.holesPlayed ? <ToPar value={myTotals.total.netToPar} /> : null} />
            <Stat label="Thru" value={myTotals.holesPlayed ? String(myTotals.holesPlayed) : "–"} />
            <Stat label="Putts" value={myStats?.putts === null || myStats?.putts === undefined ? "–" : String(myStats.putts)} />
          </div>
        </Card>
      )}

      <Card title="Leaderboard" action={<Link href={`/rounds/${roundId}/scorecard`} className="text-xs font-semibold text-accent">Scorecard ›</Link>}>
        <Leaderboard rows={snap.leaderboardNet} basis="NET" highlightId={actor?.playerId} />
      </Card>

      <Card title="Games" action={<Link href={`/rounds/${roundId}/games`} className="text-xs font-semibold text-accent">All ›</Link>}>
        {snap.games.length === 0 ? (
          <p className="text-sm text-muted">No games configured.</p>
        ) : (
          <ul className="divide-y divide-line">
            {snap.games.map((g) => (
              <li key={g.id} className="py-2">
                <p className="text-xs uppercase tracking-wide text-muted">{g.name}</p>
                <p className="font-medium text-sm">{g.summary.headline}</p>
              </li>
            ))}
          </ul>
        )}
        {snap.sideBets.length > 0 && (
          <p className="text-xs text-ink-2 mt-2">
            {snap.sideBets.filter((b) => b.status === "PROPOSED").length} pending · {snap.sideBets.filter((b) => b.status === "ACCEPTED").length} open · {snap.sideBets.filter((b) => b.status === "SETTLED").length} settled side bets
          </p>
        )}
      </Card>

      <Card title="Money position" action={snap.round.tripId ? <Link href={`/trips/${snap.round.tripId}/money`} className="text-xs font-semibold text-accent">Trip ledger ›</Link> : undefined}>
        {roundLedger.length === 0 ? (
          <p className="text-sm text-muted">{live ? "Projected from live games; nothing is posted until the round is locked." : "No money posted for this round."}</p>
        ) : null}
        <ul className="grid grid-cols-2 gap-2 text-sm mt-1">
          {snap.players.map((p) => {
            const projected = live ? snap.games.flatMap((g) => g.settlements).reduce((a, st) => a + (st.toPlayerId === p.playerId ? st.amountCents : 0) - (st.fromPlayerId === p.playerId ? st.amountCents : 0), 0) : balances[p.playerId];
            const v = live ? projected : balances[p.playerId];
            return (
              <li key={p.playerId} className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2">
                <span className="font-medium">{p.displayName}</span>
                <span className={`font-semibold ${v > 0 ? "text-ink" : v < 0 ? "text-neg" : "text-muted"}`}>{money(v, { sign: true })}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {highlights.length > 0 && (
        <Card title="Highlights">
          <ul className="flex flex-wrap gap-2">
            {highlights.map((h, i) => (
              <li key={i}>
                <Pill tone={h.label === "Birdie" ? "green" : "gold"}>{h.player} · {h.label} on {h.hole}</Pill>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {live && <LinkButton href={`/rounds/${roundId}/finish`} variant="secondary">Finish round</LinkButton>}
    </Page>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2/60 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-2xl leading-tight">{value}</p>
      {sub && <p className="text-xs font-semibold">{sub}</p>}
    </div>
  );
}
