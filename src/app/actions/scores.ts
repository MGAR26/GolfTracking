"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { saveHoleScore, type HoleScorePatch, type SaveScoreResult } from "@/server/services/scoreService";

export interface SaveScoreActionInput {
  roundId: string;
  playerId: string;
  holeNumber: number;
  patch: HoleScorePatch;
  expectedVersion: number;
  clientEventId?: string;
}

export type SaveScoreActionResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number; grossScore: number | null; putts: number | null; fairwayResult: string | null; gir: boolean | null; penaltyStrokes: number; obStrokes: number; updatedBy: string | null }
  | { status: "forbidden"; reason: string };

export async function saveScoreAction(input: SaveScoreActionInput): Promise<SaveScoreActionResult> {
  const actor = await requireActor();
  let result: SaveScoreResult;
  try {
    result = await saveHoleScore({ ...input, actorId: actor.playerId });
  } catch (e) {
    return { status: "forbidden", reason: e instanceof Error ? e.message : "Save failed" };
  }
  if (result.status === "saved") {
    revalidatePath(`/rounds/${input.roundId}`, "layout");
    return result;
  }
  if (result.status === "conflict") {
    const c = result.current;
    return { status: "conflict", version: c.version, grossScore: c.grossScore, putts: c.putts, fairwayResult: c.fairwayResult, gir: c.gir, penaltyStrokes: c.penaltyStrokes, obStrokes: c.obStrokes, updatedBy: c.updatedBy };
  }
  return result;
}
