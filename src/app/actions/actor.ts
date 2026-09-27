"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTOR_COOKIE } from "@/server/actor";

export async function setActorAction(playerId: string) {
  const jar = await cookies();
  jar.set(ACTOR_COOKIE, playerId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
