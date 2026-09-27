"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createTrip, type CreateTripInput } from "@/server/services/tripService";
import { getActor } from "@/server/actor";
import { getDb } from "@/db/client";
import { seedDatabase } from "@/db/seed";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createTripAction(input: CreateTripInput): Promise<ActionResult> {
  let tripId: string;
  try {
    const actor = await getActor();
    tripId = await createTrip(input, actor?.playerId ?? null);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create trip" };
  }
  revalidatePath("/");
  redirect(`/trips/${tripId}`);
}

export async function loadDemoTripAction(): Promise<void> {
  const db = await getDb();
  await seedDatabase(db);
  revalidatePath("/");
  redirect("/trips/trip_pinehurst_2026");
}
