"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createRound, finishRound, reopenRound, type CreateRoundInput } from "@/server/services/roundService";
import { requireActor } from "@/server/actor";
import type { ActionResult } from "./trips";

export async function createRoundAction(input: CreateRoundInput): Promise<ActionResult> {
  let roundId: string;
  try {
    const actor = await requireActor();
    roundId = await createRound(input, actor.playerId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create round" };
  }
  revalidatePath(`/trips/${input.tripId}`);
  redirect(`/rounds/${roundId}/score`);
}

export async function finishRoundAction(roundId: string, tripId: string | null): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await finishRound(roundId, actor.playerId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not finish round" };
  }
  revalidatePath(`/rounds/${roundId}`, "layout");
  if (tripId) revalidatePath(`/trips/${tripId}`, "layout");
  redirect(tripId ? `/trips/${tripId}` : `/rounds/${roundId}`);
}

export async function reopenRoundAction(roundId: string, tripId: string | null, reason: string): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reopenRound(roundId, actor.playerId, reason || "organizer correction");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reopen round" };
  }
  revalidatePath(`/rounds/${roundId}`, "layout");
  if (tripId) revalidatePath(`/trips/${tripId}`, "layout");
  return { ok: true };
}

/** Form-action wrappers: errors surface on the next render via the finish page's checks. */
export async function finishRoundFormAction(roundId: string, tripId: string | null): Promise<void> {
  const r = await finishRoundAction(roundId, tripId);
  if (!r.ok) throw new Error(r.error);
}
export async function reopenRoundFormAction(roundId: string, tripId: string | null, reason: string): Promise<void> {
  const r = await reopenRoundAction(roundId, tripId, reason);
  if (!r.ok) throw new Error(r.error);
}
