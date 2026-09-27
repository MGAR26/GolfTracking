"use client";

import { useState, useTransition } from "react";
import { resolveConflictAction } from "@/app/actions/conflicts";
import type { HoleScorePatch } from "@/server/services/scoreService";

export interface ConflictView {
  id: string;
  playerName: string;
  holeNumber: number;
  reporterName: string;
  theirsUpdatedByName: string | null;
  mine: HoleScorePatch;
  theirs: HoleScorePatch;
}

const describe = (p: HoleScorePatch) =>
  [p.grossScore !== undefined && p.grossScore !== null ? `${p.grossScore} gross` : null, p.putts !== undefined && p.putts !== null ? `${p.putts} putts` : null, p.fairwayResult ? `FW ${p.fairwayResult.toLowerCase()}` : null, p.gir === true ? "GIR" : p.gir === false ? "no GIR" : null, p.penaltyStrokes ? `${p.penaltyStrokes} pen` : null]
    .filter(Boolean)
    .join(", ") || "no values";

export function ConflictPanel({ roundId, conflicts }: { roundId: string; conflicts: ConflictView[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (id: string, resolution: "MINE" | "THEIRS" | "DISMISSED") =>
    start(async () => {
      setError(null);
      const r = await resolveConflictAction(roundId, id, resolution);
      if (!r.ok) setError(r.error);
    });
  return (
    <section className="card p-4 !border-brass" data-testid="conflict-panel">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-brass mb-2">Conflicts to reconcile ({conflicts.length})</h2>
      {error && <p className="text-sm text-neg mb-2">{error}</p>}
      <ul className="divide-y divide-line">
        {conflicts.map((c) => (
          <li key={c.id} className="py-3">
            <p className="font-medium">
              {c.playerName} · Hole {c.holeNumber}
            </p>
            <p className="text-xs text-muted">Reported by {c.reporterName}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-surface-2/60 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">{c.reporterName}&apos;s entry</p>
                <p>{describe(c.mine)}</p>
              </div>
              <div className="rounded-lg bg-surface-2/60 p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted">Saved{c.theirsUpdatedByName ? ` by ${c.theirsUpdatedByName}` : ""}</p>
                <p>{describe(c.theirs)}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button className="btn btn-primary !min-h-10 text-xs" disabled={pending} onClick={() => act(c.id, "MINE")}>Use {c.reporterName}&apos;s</button>
              <button className="btn btn-secondary !min-h-10 text-xs" disabled={pending} onClick={() => act(c.id, "THEIRS")}>Keep saved</button>
              <button className="btn btn-ghost !min-h-10 text-xs" disabled={pending} onClick={() => act(c.id, "DISMISSED")}>Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
