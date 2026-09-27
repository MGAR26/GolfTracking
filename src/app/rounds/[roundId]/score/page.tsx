import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreEntry } from "@/components/ScoreEntry";
import { Page } from "@/components/ui";
import { findScore, loadRoundSnapshot } from "@/server/services/roundProjection";
import { getActor } from "@/server/actor";
import { canEditScore, type ScoringMode, type TripRole } from "@/server/services/permissions";
import { NewSideBetForm } from "@/components/SideBetPanel";

export const metadata = { title: "Score" };

export default async function ScorePage({ params, searchParams }: { params: Promise<{ roundId: string }>; searchParams: Promise<{ hole?: string; player?: string }> }) {
  const { roundId } = await params;
  const sp = await searchParams;
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) notFound();
  const actor = await getActor();
  const requested = sp.hole ? parseInt(sp.hole, 10) : NaN;
  const holeNumber = Number.isInteger(requested) && snap.holes.some((h) => h.holeNumber === requested) ? requested : (snap.currentHole ?? snap.holes[snap.holes.length - 1].holeNumber);
  const hole = snap.holes.find((h) => h.holeNumber === holeNumber)!;
  const idx = snap.holes.findIndex((h) => h.holeNumber === holeNumber);
  const prev = idx > 0 ? snap.holes[idx - 1].holeNumber : null;
  const next = idx < snap.holes.length - 1 ? snap.holes[idx + 1].holeNumber : null;
  const actorRole = (snap.players.find((p) => p.playerId === actor?.playerId)?.tripRole as TripRole | null) ?? null;

  const players = snap.players.map((p) => {
    const row = findScore(snap, p.playerId, holeNumber);
    return {
      playerId: p.playerId,
      displayName: p.displayName,
      strokes: p.allocation[holeNumber] ?? 0,
      editable: !!actor && canEditScore({ actorId: actor.playerId, actorRole, scoringMode: snap.round.scoringMode as ScoringMode, scorerPlayerId: p.scorerPlayerId, targetPlayerId: p.playerId, roundStatus: snap.round.status }),
      entry: row.entry,
      version: row.version,
    };
  });
  const holeDone = players.every((p) => p.entry.grossScore !== null);
  const leaderLine = snap.leaderboardNet.filter((r) => r.holesPlayed > 0).slice(0, 3);

  return (
    <Page className="!pt-3">
      <header className="card p-3 flex items-center justify-between">
        <NavLink href={prev !== null ? `/rounds/${roundId}/score?hole=${prev}` : null} label="Previous hole">‹</NavLink>
        <div className="text-center">
          <p className="font-display text-2xl leading-none">Hole {hole.holeNumber}</p>
          <p className="text-xs text-ink-2 mt-1">
            Par {hole.par}{hole.yardage ? ` · ${hole.yardage} yds` : ""} · SI {hole.strokeIndex}
          </p>
        </div>
        <NavLink href={next !== null ? `/rounds/${roundId}/score?hole=${next}` : null} label="Next hole">›</NavLink>
      </header>

      {snap.round.status !== "LIVE" && <p className="text-sm text-muted text-center">This round is locked. Scores are read-only.</p>}
      {snap.round.status === "LIVE" && players.every((p) => !p.editable) && (
        <p className="text-sm text-brass text-center">You can&apos;t enter scores for this group in {snap.round.scoringMode.toLowerCase().replace("_", " ")} mode. Switch player at the top to test.</p>
      )}

      <ScoreEntry key={holeNumber} roundId={roundId} hole={{ holeNumber: hole.holeNumber, par: hole.par }} players={players} focusPlayerId={sp.player} />

      {snap.round.status === "LIVE" && actor && (
        <NewSideBetForm roundId={roundId} players={snap.players.map((p) => ({ playerId: p.playerId, displayName: p.displayName }))} actorId={actor.playerId} defaultHole={holeNumber} />
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link href={`/rounds/${roundId}/scorecard`} className="btn btn-secondary">Scorecard</Link>
        {next !== null ? (
          <Link href={`/rounds/${roundId}/score?hole=${next}`} className={`btn ${holeDone ? "btn-primary" : "btn-secondary"}`}>Next hole ›</Link>
        ) : (
          <Link href={`/rounds/${roundId}/finish`} className="btn btn-primary">Finish round</Link>
        )}
      </div>

      {leaderLine.length > 0 && (
        <p className="text-xs text-muted text-center">
          Net: {leaderLine.map((r) => `${r.displayName} ${r.netToPar === 0 ? "E" : r.netToPar > 0 ? `+${r.netToPar}` : r.netToPar}`).join(" · ")}
        </p>
      )}
    </Page>
  );
}

function NavLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) return <span className="tap inline-flex items-center justify-center text-line-strong text-2xl" aria-hidden>{children}</span>;
  return (
    <Link href={href} aria-label={label} className="tap inline-flex items-center justify-center rounded-xl bg-surface-2 text-2xl font-semibold text-ink">
      {children}
    </Link>
  );
}
