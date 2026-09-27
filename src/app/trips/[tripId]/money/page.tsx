import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Card, Page } from "@/components/ui";
import { getTripDashboard } from "@/server/services/tripService";
import { money } from "@/lib/format";

export const metadata = { title: "Money" };

export default async function MoneyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const d = await getTripDashboard(tripId);
  if (!d) notFound();
  const name = (id: string) => d.members.find((m) => m.profile.id === id)?.profile.displayName ?? id;
  const active = d.ledger.filter((e) => e.status !== "REVERSED");
  const reversed = d.ledger.filter((e) => e.status === "REVERSED");
  return (
    <>
      <AppHeader title="Money" back={`/trips/${tripId}`} subtitle={d.trip.name} />
      <Page>
        <Card title="Net position">
          <ul className="divide-y divide-line">
            {d.standings.map((s) => (
              <li key={s.playerId} className="flex items-center justify-between py-2">
                <span className="font-medium">{s.displayName}</span>
                <span className={`font-semibold ${s.moneyCents > 0 ? "text-green-ink" : s.moneyCents < 0 ? "text-red" : "text-muted"}`}>{money(s.moneyCents, { sign: true })}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Settle up" action={<span className="text-xs text-muted">{d.settlement.payments.length} payment{d.settlement.payments.length === 1 ? "" : "s"}</span>}>
          {d.settlement.payments.length === 0 ? (
            <p className="text-sm text-muted">Everyone is even.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.settlement.payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-medium">{name(p.fromPlayerId)}</span> pays <span className="font-medium">{name(p.toPlayerId)}</span>
                  </span>
                  <span className="font-semibold">{money(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted mt-2">Fewest payments that clear every balance. Itemized obligations below stay on record.{d.settlement.residualCents !== 0 ? ` Residual: ${money(d.settlement.residualCents)}` : ""}</p>
        </Card>

        <Card title="Itemized ledger" action={<span className="text-xs text-muted">{active.length} entries</span>}>
          {active.length === 0 ? (
            <p className="text-sm text-muted">Nothing posted yet. Lock a round or settle a side bet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {active.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      {name(e.fromPlayerId)} → {name(e.toPlayerId)}
                    </span>
                    <span className="font-semibold">{money(e.amountCents)}</span>
                  </div>
                  <p className="text-xs text-muted">{e.sourceType === "SIDE_BET" ? "Side bet" : e.sourceType === "GAME" ? "Game" : e.sourceType} · {e.memo}</p>
                </li>
              ))}
            </ul>
          )}
          {reversed.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs font-semibold text-muted cursor-pointer">{reversed.length} reversed / corrected entries</summary>
              <ul className="text-xs text-muted mt-1 space-y-1">
                {reversed.map((e) => (
                  <li key={e.id} className="line-through">
                    {name(e.fromPlayerId)} → {name(e.toPlayerId)} {money(e.amountCents)} · {e.memo}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      </Page>
    </>
  );
}
