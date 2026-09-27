"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { acceptSideBet, createSideBet, declineSideBet, resolveSideBet, type CreateSideBetInput } from "@/server/services/sideBetService";
import type { ActionResult } from "./trips";

function done(roundId: string): ActionResult {
  revalidatePath(`/rounds/${roundId}`, "layout");
  return { ok: true };
}
function fail(e: unknown, fallback: string): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : fallback };
}

export async function createSideBetAction(input: CreateSideBetInput): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await createSideBet(input, actor.playerId);
    return done(input.roundId);
  } catch (e) {
    return fail(e, "Could not create side bet");
  }
}
export async function acceptSideBetAction(roundId: string, betId: string): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await acceptSideBet(roundId, betId, actor.playerId);
    return done(roundId);
  } catch (e) {
    return fail(e, "Could not accept");
  }
}
export async function declineSideBetAction(roundId: string, betId: string): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await declineSideBet(roundId, betId, actor.playerId);
    return done(roundId);
  } catch (e) {
    return fail(e, "Could not decline");
  }
}
export async function resolveSideBetAction(roundId: string, betId: string, winner: "A" | "B" | "TIE" | "AUTO"): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await resolveSideBet(roundId, betId, winner, actor.playerId);
    return done(roundId);
  } catch (e) {
    return fail(e, "Could not resolve");
  }
}
