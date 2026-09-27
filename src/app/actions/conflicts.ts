"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { reportConflict, resolveConflict, type ReportConflictInput } from "@/server/services/conflictService";
import type { ActionResult } from "./trips";

export async function reportConflictAction(input: ReportConflictInput): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await reportConflict(input, actor.playerId);
    revalidatePath(`/rounds/${input.roundId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not report conflict" };
  }
}

export async function resolveConflictAction(roundId: string, conflictId: string, resolution: "MINE" | "THEIRS" | "DISMISSED"): Promise<ActionResult> {
  try {
    const actor = await requireActor();
    await resolveConflict(conflictId, resolution, actor.playerId);
    revalidatePath(`/rounds/${roundId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not resolve conflict" };
  }
}
