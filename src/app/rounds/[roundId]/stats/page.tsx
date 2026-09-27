import { notFound } from "next/navigation";
import { Card, Page } from "@/components/ui";
import { loadRoundSnapshot } from "@/server/services/roundProjection";
import { getActor } from "@/server/actor";

export const metadata = { title: "Stats" };

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v)}%`);
const num = (v: number | null) => (v === null ? "–" : String(v));

export default async function StatsPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) notFound();
  const actor = await getActor();
  const ordered = [...snap.players].sort((a, b) => (a.playerId === actor?.playerId ? -1 : b.playerId === actor?.playerId ? 1 : 0));
  return (
    <Page>
      {ordered.map((p) => {
        const st = snap.stats[p.playerId];
        const t = snap.totals[p.playerId];
        return (
          <Card key={p.playerId} title={`${p.displayName} · thru ${t.holesPlayed}`}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Tile label="Fairways" value={pct(st.fairwayPct)} sub={st.fairwayOpportunities ? `${st.fairwaysHit}/${st.fairwayOpportunities}` : "not tracked"} />
              <Tile label="GIR" value={pct(st.girPct)} sub={st.girOpportunities ? `${st.girs}/${st.girOpportunities}` : "not tracked"} />
              <Tile label="Putts" value={num(st.putts)} sub={st.puttsPerGir !== null ? `${st.puttsPerGir}/GIR` : ""} />
              <Tile label="Birdies+" value={String(st.birdiesOrBetter)} sub={`${st.pars} pars`} />
              <Tile label="Bogeys" value={String(st.bogeys)} sub={`${st.doublesOrWorse} double+`} />
              <Tile label="Penalties" value={String(st.penaltyStrokes)} sub={st.obStrokes ? `${st.obStrokes} OB` : ""} />
              <Tile label="Par 3 avg" value={num(st.par3Avg)} />
              <Tile label="Par 4 avg" value={num(st.par4Avg)} />
              <Tile label="Par 5 avg" value={num(st.par5Avg)} />
              <Tile label="Scrambling" value={pct(st.scramblingPct)} />
              <Tile label="Sand saves" value={pct(st.sandSavePct)} />
              <Tile label="Strokes rcvd" value={String(t.strokesReceived)} sub={`CH ${p.courseHandicap}`} />
            </div>
          </Card>
        );
      })}
      <p className="text-xs text-muted text-center">Percentages only count holes where that stat was entered. Nothing is inferred from the score.</p>
    </Page>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 py-2 px-1">
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-xl leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-ink-2">{sub}</p>}
    </div>
  );
}
