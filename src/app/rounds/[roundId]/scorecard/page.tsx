import Link from "next/link";
import { notFound } from "next/navigation";
import { Scorecard } from "@/components/Scorecard";
import { Page } from "@/components/ui";
import { loadRoundSnapshot } from "@/server/services/roundProjection";

export const metadata = { title: "Scorecard" };

export default async function ScorecardPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const snap = await loadRoundSnapshot(roundId);
  if (!snap) notFound();
  return (
    <Page>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Scorecard</h2>
        <Link href={`/rounds/${roundId}/score`} className="text-sm font-semibold text-green">Hole entry ›</Link>
      </div>
      <Scorecard snap={snap} />
    </Page>
  );
}
