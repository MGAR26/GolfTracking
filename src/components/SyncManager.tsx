"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { saveScoreAction } from "@/app/actions/scores";
import { reportConflictAction } from "@/app/actions/conflicts";
import { isNetworkError, offlineQueue } from "@/lib/offlineQueue";

/**
 * Replays queued hole-score saves in order whenever the device is online. Mounted once
 * at the root so replay continues even after navigating away from the score screen.
 */
export function SyncManager() {
  const router = useRouter();
  const items = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.list, offlineQueue.serverSnapshot);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const replaying = useRef(false);

  const replay = useCallback(async () => {
    if (replaying.current || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    replaying.current = true;
    try {
      let changed = false;
      for (const item of offlineQueue.list().filter((q) => q.status === "pending")) {
        try {
          const r = await saveScoreAction({
            roundId: item.roundId,
            playerId: item.playerId,
            holeNumber: item.holeNumber,
            patch: item.patch,
            expectedVersion: item.expectedVersion,
            clientEventId: item.id,
          });
          if (r.status === "saved") {
            offlineQueue.remove(item.id);
            changed = true;
          } else if (r.status === "conflict") {
            // Someone else scored this hole while we were offline: hand both versions to the organizer.
            const reported = await reportConflictAction({
              roundId: item.roundId,
              playerId: item.playerId,
              holeNumber: item.holeNumber,
              mine: item.patch,
              theirs: { grossScore: r.grossScore, putts: r.putts, fairwayResult: r.fairwayResult as never, gir: r.gir, penaltyStrokes: r.penaltyStrokes, obStrokes: r.obStrokes },
              theirsUpdatedBy: r.updatedBy,
            });
            offlineQueue.update(item.id, { status: "conflict", message: reported.ok ? `Hole ${item.holeNumber} was changed by another device while you were offline; sent to the organizer.` : reported.error });
            changed = true;
          } else {
            offlineQueue.update(item.id, { status: "error", message: r.reason });
          }
        } catch (err) {
          if (isNetworkError(err)) break; // still offline; try again later
          offlineQueue.update(item.id, { status: "error", message: err instanceof Error ? err.message : "Save failed" });
        }
      }
      if (changed) router.refresh();
    } finally {
      replaying.current = false;
    }
  }, [router]);

  useEffect(() => {
    const onOnline = () => void replay();
    window.addEventListener("online", onOnline);
    void replay();
    const interval = setInterval(() => void replay(), 15_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [replay]);

  const pending = items.filter((i) => i.status === "pending").length;
  const conflicts = items.filter((i) => i.status === "conflict");
  const errors = items.filter((i) => i.status === "error");
  if (online && pending === 0 && conflicts.length === 0 && errors.length === 0) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-2rem)]" style={{ top: "calc(3.5rem + 8px)" }} role="status" data-testid="sync-status">
      <div className={`card px-3 py-2 text-xs font-semibold flex items-center gap-2 ${conflicts.length || errors.length ? "!border-brass" : ""}`}>
        <span className={`inline-block h-2 w-2 rounded-full ${!online ? "bg-neg" : pending ? "bg-brass" : "bg-accent"}`} />
        {!online ? `Offline · ${pending} change${pending === 1 ? "" : "s"} queued` : pending ? `Syncing ${pending} change${pending === 1 ? "" : "s"}…` : conflicts.length ? conflicts[0].message : errors[0]?.message}
        {(conflicts.length > 0 || errors.length > 0) && (
          <button type="button" className="text-accent underline" onClick={() => [...conflicts, ...errors].forEach((c) => offlineQueue.remove(c.id))}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
