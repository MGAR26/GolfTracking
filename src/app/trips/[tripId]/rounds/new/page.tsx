import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { NewRoundForm } from "@/components/NewRoundForm";
import { Page } from "@/components/ui";
import { getDb, schema as s } from "@/db/client";
import { getTripMembers } from "@/server/services/tripService";

export const metadata = { title: "Add round" };

export default async function NewRoundPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const db = await getDb();
  const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, tripId));
  if (!trip) notFound();
  const members = await getTripMembers(tripId);
  const tees = await db
    .select({ teeSetId: s.teeSets.id, teeName: s.teeSets.name, courseName: s.courses.name, par: s.teeSets.par, courseRating: s.teeSets.courseRating, slopeRating: s.teeSets.slopeRating })
    .from(s.teeSets)
    .innerJoin(s.courses, eq(s.teeSets.courseId, s.courses.id))
    .orderBy(asc(s.courses.name), asc(s.teeSets.name));
  return (
    <>
      <AppHeader title="Add round" back={`/trips/${tripId}`} subtitle={trip.name} />
      <Page>
        <NewRoundForm
          tripId={tripId}
          tees={tees.map((t) => ({ teeSetId: t.teeSetId, label: `${t.courseName} · ${t.teeName}`, par: t.par, courseRating: t.courseRating, slopeRating: t.slopeRating }))}
          players={members.map((m) => ({ playerId: m.profile.id, displayName: m.profile.displayName, handicapIndex: m.profile.handicapIndex }))}
        />
      </Page>
    </>
  );
}
