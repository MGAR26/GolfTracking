"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveScoreAction, type SaveScoreActionResult } from "@/app/actions/scores";
import { reportConflictAction } from "@/app/actions/conflicts";
import { isNetworkError, offlineQueue } from "@/lib/offlineQueue";
import type { HoleScorePatch } from "@/server/services/scoreService";
import type { HoleEntry, FairwayResult } from "@/domain/types";
import { StrokeDots } from "./ui";

export interface ScoreEntryPlayer {
  playerId: string;
  displayName: string;
  strokes: number;
  editable: boolean;
  entry: HoleEntry;
  version: number;
}

type SyncState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "queued" }
  | { kind: "updated" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; theirs: Extract<SaveScoreActionResult, { status: "conflict" }> };

interface RowState {
  entry: HoleEntry;
  version: number;
  sync: SyncState;
  celebrate: "birdie" | "eagle" | null;
}

export function ScoreEntry({ roundId, hole, players, focusPlayerId }: { roundId: string; hole: { holeNumber: number; par: number }; players: ScoreEntryPlayer[]; focusPlayerId?: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      players.map((p) => {
        const queued = offlineQueue.find(roundId, p.playerId, hole.holeNumber);
        const entry = queued && queued.status === "pending" ? { ...p.entry, ...queued.patch } : p.entry;
        return [p.playerId, { entry, version: p.version, sync: queued && queued.status === "pending" ? { kind: "queued" } : { kind: "idle" }, celebrate: null }];
      }),
    ),
  );
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Server versions live in a ref (mutated only from async callbacks / handlers) so the
  // debounced save always sends the latest version it has acknowledged.
  const versions = useRef<Record<string, number>>(Object.fromEntries(players.map((p) => [p.playerId, p.version])));
  const pendingPatch = useRef<Record<string, Partial<HoleEntry>>>({});
  const inFlight = useRef<Record<string, boolean>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 250);
  }, [router]);

  const enqueue = useCallback(
    (playerId: string, patch: Partial<HoleEntry>) => {
      offlineQueue.enqueue({ roundId, playerId, holeNumber: hole.holeNumber, patch, expectedVersion: versions.current[playerId] ?? 0 });
      setRows((r) => ({ ...r, [playerId]: { ...r[playerId], sync: { kind: "queued" } } }));
    },
    [roundId, hole.holeNumber],
  );

  const flush = useCallback(
    async (playerId: string, expectedVersionOverride?: number) => {
      const patch = pendingPatch.current[playerId];
      if (!patch || Object.keys(patch).length === 0) return;
      pendingPatch.current[playerId] = {};
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        enqueue(playerId, patch);
        return;
      }
      inFlight.current[playerId] = true;
      setRows((r) => ({ ...r, [playerId]: { ...r[playerId], sync: { kind: "saving" } } }));
      const expectedVersion = expectedVersionOverride ?? versions.current[playerId] ?? 0;
      let result: SaveScoreActionResult;
      try {
        result = await saveScoreAction({ roundId, playerId, holeNumber: hole.holeNumber, patch, expectedVersion, clientEventId: crypto.randomUUID() });
      } catch (err) {
        inFlight.current[playerId] = false;
        if (isNetworkError(err)) {
          enqueue(playerId, patch);
          return;
        }
        setRows((r) => ({ ...r, [playerId]: { ...r[playerId], sync: { kind: "error", message: err instanceof Error ? err.message : "Save failed" } } }));
        return;
      }
      inFlight.current[playerId] = false;
      if (result.status === "saved") versions.current[playerId] = result.version;
      else if (result.status === "conflict") versions.current[playerId] = result.version;
      setRows((r) => {
        const row = r[playerId];
        if (result.status === "saved") return { ...r, [playerId]: { ...row, version: result.version, sync: { kind: "saved" } } };
        if (result.status === "conflict") {
          // Keep the unsent patch so the user can choose to overwrite.
          pendingPatch.current[playerId] = { ...patch, ...pendingPatch.current[playerId] };
          return { ...r, [playerId]: { ...row, sync: { kind: "conflict", theirs: result } } };
        }
        return { ...r, [playerId]: { ...row, sync: { kind: "error", message: result.reason } } };
      });
      if (result.status === "saved") scheduleRefresh();
    },
    [roundId, hole.holeNumber, scheduleRefresh, enqueue],
  );

  const update = useCallback(
    (playerId: string, patch: Partial<HoleEntry>) => {
      setRows((r) => {
        const row = r[playerId];
        const entry = { ...row.entry, ...patch };
        let celebrate: RowState["celebrate"] = null;
        if (patch.grossScore !== undefined && patch.grossScore !== null && row.entry.grossScore !== patch.grossScore) {
          const toPar = patch.grossScore - hole.par;
          celebrate = toPar <= -2 ? "eagle" : toPar === -1 ? "birdie" : null;
        }
        return { ...r, [playerId]: { ...row, entry, celebrate, sync: row.sync.kind === "conflict" ? row.sync : { kind: "idle" } } };
      });
      pendingPatch.current[playerId] = { ...pendingPatch.current[playerId], ...patch };
      if (timers.current[playerId]) clearTimeout(timers.current[playerId]);
      timers.current[playerId] = setTimeout(() => flush(playerId), 450);
    },
    [flush, hole.par],
  );

  // Adopt newer server state (another device saved this hole) when this row has nothing local in progress.
  useEffect(() => {
    setRows((r) => {
      let changed = false;
      const next = { ...r };
      for (const p of players) {
        const row = r[p.playerId];
        if (!row) continue;
        const busy = inFlight.current[p.playerId] || Object.keys(pendingPatch.current[p.playerId] ?? {}).length > 0 || row.sync.kind === "conflict" || row.sync.kind === "queued";
        if (!busy && p.version > row.version) {
          versions.current[p.playerId] = p.version;
          next[p.playerId] = { ...row, entry: p.entry, version: p.version, sync: { kind: "updated" } };
          changed = true;
        }
      }
      return changed ? next : r;
    });
  }, [players]);

  // When a queued save is replayed by the SyncManager, mark the row saved and pull the server copy.
  useEffect(() => {
    return offlineQueue.subscribe(() => {
      setRows((r) => {
        let changed = false;
        const next = { ...r };
        for (const p of players) {
          const row = r[p.playerId];
          if (row?.sync.kind === "queued" && !offlineQueue.find(roundId, p.playerId, hole.holeNumber)) {
            next[p.playerId] = { ...row, sync: { kind: "saved" } };
            changed = true;
          }
        }
        return changed ? next : r;
      });
    });
  }, [players, roundId, hole.holeNumber]);

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!focusPlayerId) return;
    document.getElementById(`player-${focusPlayerId}`)?.scrollIntoView({ block: "center" });
  }, [focusPlayerId]);

  const adoptTheirs = (playerId: string, theirs: Extract<SaveScoreActionResult, { status: "conflict" }>) => {
    pendingPatch.current[playerId] = {};
    versions.current[playerId] = theirs.version;
    setRows((r) => ({
      ...r,
      [playerId]: {
        ...r[playerId],
        version: theirs.version,
        entry: {
          ...r[playerId].entry,
          grossScore: theirs.grossScore,
          putts: theirs.putts,
          fairwayResult: theirs.fairwayResult as FairwayResult | null,
          gir: theirs.gir,
          penaltyStrokes: theirs.penaltyStrokes,
          obStrokes: theirs.obStrokes,
        },
        sync: { kind: "idle" },
      },
    }));
    scheduleRefresh();
  };

  return (
    <div className="flex flex-col gap-3">
      {players.map((p) => {
        const row = rows[p.playerId];
        return (
          <PlayerRow
            key={p.playerId}
            player={p}
            par={hole.par}
            row={row}
            onChange={(patch) => update(p.playerId, patch)}
            onKeepTheirs={() => adoptTheirs(p.playerId, (row.sync as Extract<SyncState, { kind: "conflict" }>).theirs)}
            onKeepMine={() => {
              const theirs = (row.sync as Extract<SyncState, { kind: "conflict" }>).theirs;
              // Re-send the full current row on top of their version.
              pendingPatch.current[p.playerId] = fullPatch(row.entry);
              versions.current[p.playerId] = theirs.version;
              setRows((r) => ({ ...r, [p.playerId]: { ...r[p.playerId], version: theirs.version } }));
              flush(p.playerId, theirs.version);
            }}
            onAskOrganizer={async () => {
              const theirs = (row.sync as Extract<SyncState, { kind: "conflict" }>).theirs;
              const r = await reportConflictAction({
                roundId,
                playerId: p.playerId,
                holeNumber: hole.holeNumber,
                mine: fullPatch(row.entry),
                theirs: { grossScore: theirs.grossScore, putts: theirs.putts, fairwayResult: theirs.fairwayResult as FairwayResult | null, gir: theirs.gir, penaltyStrokes: theirs.penaltyStrokes, obStrokes: theirs.obStrokes },
                theirsUpdatedBy: theirs.updatedBy,
              });
              if (r.ok) adoptTheirs(p.playerId, theirs);
              else setRows((rs) => ({ ...rs, [p.playerId]: { ...rs[p.playerId], sync: { kind: "error", message: r.error } } }));
            }}
          />
        );
      })}
    </div>
  );
}

function fullPatch(e: HoleEntry): HoleScorePatch {
  return {
    grossScore: e.grossScore,
    putts: e.putts,
    fairwayResult: e.fairwayResult,
    gir: e.gir,
    penaltyStrokes: e.penaltyStrokes,
    obStrokes: e.obStrokes,
    sandAttempt: e.sandAttempt,
    sandSave: e.sandSave,
    upDownAttempt: e.upDownAttempt,
    upDown: e.upDown,
    driveDistance: e.driveDistance,
  };
}

function PlayerRow({ player, par, row, onChange, onKeepTheirs, onKeepMine, onAskOrganizer }: { player: ScoreEntryPlayer; par: number; row: RowState; onChange: (patch: Partial<HoleEntry>) => void; onKeepTheirs: () => void; onKeepMine: () => void; onAskOrganizer: () => void }) {
  const [more, setMore] = useState(false);
  const e = row.entry;
  const disabled = !player.editable;
  const gross = e.grossScore;
  const toPar = gross === null ? null : gross - par;
  const net = gross === null ? null : gross - player.strokes;

  const setGross = (n: number | null) => onChange({ grossScore: n === null ? null : Math.max(1, Math.min(20, n)) });

  return (
    <section id={`player-${player.playerId}`} className={`card p-3 ${disabled ? "opacity-80" : ""}`} aria-label={`${player.displayName} hole entry`}>
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{player.displayName}</span>
          <StrokeDots n={player.strokes} />
          {player.strokes !== 0 && <span className="text-[11px] text-muted">{player.strokes > 0 ? `gets ${player.strokes}` : `gives ${-player.strokes}`}</span>}
        </div>
        <SyncBadge sync={row.sync} editable={player.editable} />
      </header>

      <div className="flex items-center gap-2">
        <button type="button" className="tap btn btn-secondary !min-h-14 !w-14 !px-0 text-2xl" aria-label="Minus one stroke" disabled={disabled || gross === 1} onClick={() => setGross(gross === null ? par - 1 : gross - 1)}>
          −
        </button>
        <button
          type="button"
          className="tap flex-1 h-14 rounded-xl border border-line bg-surface-2/60 flex flex-col items-center justify-center leading-none"
          disabled={disabled}
          onClick={() => gross === null && setGross(par)}
          aria-label={gross === null ? `Set score to par ${par}` : `Score ${gross}`}
        >
          <span className={`font-display text-3xl ${gross === null ? "text-muted" : ""} ${row.celebrate === "birdie" ? "celebrate-birdie px-2" : row.celebrate === "eagle" ? "celebrate-eagle px-2" : ""}`}>{gross ?? par}</span>
          <span className="text-[11px] text-muted mt-1">
            {gross === null ? "tap for par" : toPar === 0 ? "par" : toPar === -1 ? "birdie" : toPar === -2 ? "eagle" : (toPar ?? 0) < -2 ? "albatross" : toPar === 1 ? "bogey" : toPar === 2 ? "double" : `+${toPar}`}
            {net !== null && player.strokes !== 0 ? ` · net ${net}` : ""}
          </span>
        </button>
        <button type="button" className="tap btn btn-primary !min-h-14 !w-14 !px-0 text-2xl" aria-label="Plus one stroke" disabled={disabled} onClick={() => setGross(gross === null ? par : gross + 1)}>
          +
        </button>
      </div>

      <div className={`mt-3 grid gap-2 ${par >= 4 ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1"}`}>
        {par >= 4 && (
          <div>
            <span className="label">Fairway</span>
            <div className="seg" role="group" aria-label="Fairway">
              {(["LEFT", "HIT", "RIGHT"] as const).map((v) => (
                <button key={v} type="button" disabled={disabled} aria-pressed={e.fairwayResult === v} onClick={() => onChange({ fairwayResult: e.fairwayResult === v ? null : v })}>
                  {v === "HIT" ? "Hit" : v === "LEFT" ? "◀ L" : "R ▶"}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <span className="label">Green</span>
          <div className="seg" role="group" aria-label="Green in regulation">
            <button type="button" disabled={disabled} aria-pressed={e.gir === true} onClick={() => onChange({ gir: e.gir === true ? null : true })}>
              GIR ⛳
            </button>
            <button type="button" disabled={disabled} aria-pressed={e.gir === false} onClick={() => onChange({ gir: e.gir === false ? null : false })}>
              Miss
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1.4fr_1fr] gap-2">
        <div>
          <span className="label">Putts</span>
          <div className="seg" role="group" aria-label="Putts">
            {[0, 1, 2, 3].map((n) => (
              <button key={n} type="button" disabled={disabled} aria-pressed={e.putts === n || (n === 3 && (e.putts ?? 0) > 3)} onClick={() => onChange({ putts: e.putts === n ? null : n === 3 && (e.putts ?? 0) >= 3 ? (e.putts ?? 3) + 1 : n })}>
                {n === 3 ? ((e.putts ?? 0) > 3 ? `${e.putts}` : "3+") : n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Penalty</span>
          <div className="seg" role="group" aria-label="Penalty strokes">
            <button type="button" disabled={disabled || e.penaltyStrokes === 0} onClick={() => onChange({ penaltyStrokes: Math.max(0, e.penaltyStrokes - 1) })} aria-label="Fewer penalty strokes">
              −
            </button>
            <button type="button" disabled aria-pressed={e.penaltyStrokes > 0} className="!opacity-100">
              {e.penaltyStrokes}
            </button>
            <button type="button" disabled={disabled} onClick={() => onChange({ penaltyStrokes: e.penaltyStrokes + 1 })} aria-label="More penalty strokes">
              +
            </button>
          </div>
        </div>
      </div>

      <button type="button" className="mt-2 text-xs font-semibold text-accent tap !min-h-9" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? "Less" : "More stats"}
      </button>
      {more && (
        <div className="grid grid-cols-2 gap-2 mt-1">
          <Stepper label="OB strokes" value={e.obStrokes} disabled={disabled} onChange={(v) => onChange({ obStrokes: v })} />
          <NumberField label="Drive (yds)" value={e.driveDistance} disabled={disabled} onChange={(v) => onChange({ driveDistance: v })} />
          <TriState label="Sand save" attempt={e.sandAttempt} result={e.sandSave} disabled={disabled} onChange={(attempt, result) => onChange({ sandAttempt: attempt, sandSave: result })} />
          <TriState label="Up & down" attempt={e.upDownAttempt} result={e.upDown} disabled={disabled} onChange={(attempt, result) => onChange({ upDownAttempt: attempt, upDown: result })} />
        </div>
      )}

      {row.sync.kind === "conflict" && (
        <div className="mt-3 rounded-xl bg-brass-soft p-3 text-sm">
          <p className="font-semibold text-brass">Someone else saved this hole first.</p>
          <p className="text-ink-2 mt-0.5">
            Theirs: {row.sync.theirs.grossScore ?? "–"} gross{row.sync.theirs.putts !== null ? `, ${row.sync.theirs.putts} putts` : ""}. Yours: {gross ?? "–"} gross{e.putts !== null ? `, ${e.putts} putts` : ""}.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" className="btn btn-secondary !min-h-10 text-sm" onClick={onKeepTheirs}>
              Keep theirs
            </button>
            <button type="button" className="btn btn-primary !min-h-10 text-sm" onClick={onKeepMine}>
              Use mine
            </button>
            <button type="button" className="btn btn-ghost !min-h-10 text-sm" onClick={onAskOrganizer}>
              Ask organizer
            </button>
          </div>
        </div>
      )}
      {row.sync.kind === "error" && <p className="mt-2 text-sm text-neg">{row.sync.message}</p>}
    </section>
  );
}

function SyncBadge({ sync, editable }: { sync: SyncState; editable: boolean }) {
  if (!editable) return <span className="text-[11px] text-muted">view only</span>;
  const map: Record<SyncState["kind"], { text: string; cls: string }> = {
    idle: { text: "", cls: "" },
    saving: { text: "Saving…", cls: "text-muted" },
    saved: { text: "Synced", cls: "text-accent" },
    queued: { text: "Queued offline", cls: "text-brass" },
    updated: { text: "Updated by another device", cls: "text-accent" },
    error: { text: "Not saved", cls: "text-neg" },
    conflict: { text: "Conflict", cls: "text-brass" },
  };
  const m = map[sync.kind];
  return <span className={`text-[11px] font-semibold ${m.cls}`} aria-live="polite">{m.text}</span>;
}

function Stepper({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (v: number) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="seg">
        <button type="button" disabled={disabled || value === 0} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>−</button>
        <button type="button" disabled className="!opacity-100" aria-pressed={value > 0}>{value}</button>
        <button type="button" disabled={disabled} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>+</button>
      </div>
    </div>
  );
}

function NumberField({ label, value, disabled, onChange }: { label: string; value: number | null; disabled: boolean; onChange: (v: number | null) => void }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input type="number" inputMode="numeric" className="field" disabled={disabled} value={value ?? ""} min={0} max={500} onChange={(ev) => onChange(ev.target.value === "" ? null : Number(ev.target.value))} />
    </label>
  );
}

function TriState({ label, attempt, result, disabled, onChange }: { label: string; attempt: boolean | null; result: boolean | null; disabled: boolean; onChange: (attempt: boolean | null, result: boolean | null) => void }) {
  const state = attempt !== true ? "none" : result ? "yes" : "no";
  return (
    <div>
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        <button type="button" disabled={disabled} aria-pressed={state === "none"} onClick={() => onChange(null, null)}>n/a</button>
        <button type="button" disabled={disabled} aria-pressed={state === "yes"} onClick={() => onChange(true, true)}>✓</button>
        <button type="button" disabled={disabled} aria-pressed={state === "no"} onClick={() => onChange(true, false)}>✗</button>
      </div>
    </div>
  );
}
