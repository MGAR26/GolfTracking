import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema as s } from "@/db/client";
import { AppHeader } from "@/components/AppHeader";
import { RoundTabs } from "@/components/RoundTabs";

export default async function RoundLayout({ children, params }: { children: React.ReactNode; params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  const db = await getDb();
  const [row] = await db
    .select({ round: s.rounds, course: s.courses, tee: s.teeSets })
    .from(s.rounds)
    .innerJoin(s.courses, eq(s.rounds.courseId, s.courses.id))
    .innerJoin(s.teeSets, eq(s.rounds.teeSetId, s.teeSets.id))
    .where(eq(s.rounds.id, roundId));
  if (!row) notFound();
  return (
    <>
      <AppHeader title={row.round.name ?? row.course.name} back={row.round.tripId ? `/trips/${row.round.tripId}` : "/"} subtitle={`${row.course.name} · ${row.tee.name} · ${row.tee.courseRating}/${row.tee.slopeRating}`} />
      {children}
      <RoundTabs roundId={roundId} />
    </>
  );
}
