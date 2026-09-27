"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoundChange } from "@/server/realtime/bus";
import { liveEvents } from "@/lib/liveEvents";

/**
 * Subscribes to the round's SSE stream and refreshes server-rendered views when another
 * device changes something. Own writes already refresh via revalidatePath, so events
 * from the current actor are ignored to avoid double renders.
 */
export function RoundLive({ roundId, actorId }: { roundId: string; actorId: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "offline">("connecting");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 200);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/rounds/${roundId}/events`);
      es.addEventListener("hello", () => setState("live"));
      es.addEventListener("change", (ev) => {
        const change = JSON.parse((ev as MessageEvent).data) as RoundChange;
        liveEvents.emit(change);
        if (change.actorId !== actorId) scheduleRefresh();
      });
      es.onerror = () => {
        setState("offline");
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    const onOnline = () => {
      if (es?.readyState === EventSource.CLOSED) connect();
      scheduleRefresh();
    };
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.removeEventListener("online", onOnline);
    };
  }, [roundId, actorId, router]);

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted" aria-live="polite" data-testid="live-status" data-state={state}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${state === "live" ? "bg-green" : state === "offline" ? "bg-red" : "bg-line-strong"}`} />
      {state === "live" ? "Live" : state === "offline" ? "Reconnecting" : "Connecting"}
    </span>
  );
}
