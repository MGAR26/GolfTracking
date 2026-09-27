import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Page, ToPar } from "@/components/ui";
import { loadRoundSnapshot } from "@/server/services/roundProjection";
import { checkRoundFinishable } from "@/server/services/roundService";
import { finishRoundFormAction } from "@/app/actions/rounds";
import { money } from "@/lib/format";

export const metadata = { title: "Finish round" };

export default async function FinishPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) notFound();
  const check = await checkRoundFinishable(roundId);
  const names = Object.fromEntries(snap.players.map((p) => [p.playerId, p.displayName]));
  const settlements = snap.games.flatMap((g) => g.settlements.map((st) => ({ ...st, game: g.name })));
  const wagered = settlements.reduce((a, s) => a + s.amountCents, 0);
  return (
    <Page>
      <h2 className="font-display text-2xl">Finish round</h2>
      {!check.ok && (
        <Card title="Before you can lock">
          <ul className="text-sm space-y-1.5">
            {check.problems.map((p, i) => (
              <li key={i} className="flex gap-2 text-red"><span aria-hidden>•</span>{p}</li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Link href={`/rounds/${roundId}/score`} className="btn btn-secondary text-sm">Fix scores</Link>
            <Link href={`/rounds/${roundId}/games`} className="btn btn-secondary text-sm">Resolve bets</Link>
          </div>
        </Card>
      )}
      <Card title="Recap">
        <ul className="divide-y divide-line text-sm">
          {snap.leaderboardNet.map((r) => (
            <li key={r.playerId} className="flex items-center justify-between py-2">
              <span className="font-medium">{r.tied ? "T" : ""}{r.position}. {r.displayName}</span>
              <span>
                {r.gross} gross / <span className="font-semibold">{r.net} net</span> <ToPar value={r.netToPar} className="text-xs" />
              </span>
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1 text-sm">
          {snap.games.map((g) => (
            <li key={g.id}><span className="text-muted">{g.name}:</span> {g.summary.headline}</li>
          ))}
          {snap.sideBets.filter((b) => b.status === "SETTLED").map((b) => (
            <li key={b.id}><span className="text-muted">Side bet:</span> {b.resolution?.winnerPlayerId ? `${names[b.resolution.winnerPlayerId]} wins ${b.terms.description}` : b.terms.description}</li>
          ))}
        </ul>
        <p className="text-sm font-semibold mt-3">{money(wagered)} in game wagers to post</p>
      </Card>
      {settlements.length > 0 && (
        <Card title="Ledger entries to post">
          <ul className="divide-y divide-line text-sm">
            {settlements.map((st, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between">
                <span>{names[st.fromPlayerId]} → {names[st.toPlayerId]} <span className="text-muted">· {st.game}: {st.memo}</span></span>
                <span className="font-semibold">{money(st.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <form action={finishRoundFormAction.bind(null, roundId, snap.round.tripId)}>
        <button type="submit" className="btn btn-primary w-full" disabled={!check.ok}>
          Lock round & post results
        </button>
        <p className="text-xs text-muted mt-2 text-center">Locking makes scores read-only, posts ledger entries, and {snap.round.countsTowardTrip ? "adds this round to trip standings" : "keeps this round standalone"}. Organizers can reopen with an audited correction.</p>
      </form>
    </Page>
  );
}
