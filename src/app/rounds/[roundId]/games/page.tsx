import { notFound } from "next/navigation";
import { GameCard } from "@/components/GameCard";
import { NewSideBetForm, SideBetList } from "@/components/SideBetPanel";
import { Card, Page } from "@/components/ui";
import { loadRoundSnapshot } from "@/server/services/roundProjection";
import { getActor } from "@/server/actor";

export const metadata = { title: "Games" };

export default async function GamesPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) notFound();
  const actor = await getActor();
  const names = Object.fromEntries(snap.players.map((p) => [p.playerId, p.displayName]));
  const me = snap.players.find((p) => p.playerId === actor?.playerId);
  const canOrganize = !!me && (me.tripRole === "OWNER" || me.tripRole === "ORGANIZER");
  const live = snap.round.status === "LIVE";
  return (
    <Page>
      {snap.games.length === 0 && <p className="text-sm text-muted">No games configured for this round.</p>}
      {snap.games.map((g) => (
        <GameCard key={g.id} game={g} playerNames={names} />
      ))}
      <Card title="Side bets" action={<span className="text-xs text-muted">Extra · separate from games</span>}>
        <SideBetList roundId={roundId} bets={snap.sideBets} players={snap.players} actorId={actor?.playerId ?? ""} canOrganize={canOrganize} live={live} />
      </Card>
      {live && actor && <NewSideBetForm roundId={roundId} players={snap.players} actorId={actor.playerId} defaultHole={snap.currentHole} />}
    </Page>
  );
}
