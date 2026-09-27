"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActorAction } from "@/app/actions/actor";

export function ActorSwitcher({ players, currentId }: { players: { id: string; name: string }[]; currentId: string | null }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (players.length === 0) return null;
  return (
    <label className="flex items-center gap-1 text-xs text-ink-2">
      <span className="sr-only">Acting as</span>
      <select
        aria-label="Acting as player"
        className="field !min-h-9 !py-0 !px-2 text-xs font-semibold"
        value={currentId ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setActorAction(e.target.value);
            router.refresh();
          })
        }
      >
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            You: {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
