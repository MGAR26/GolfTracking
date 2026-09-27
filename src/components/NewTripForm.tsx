"use client";

import { useState, useTransition } from "react";
import { createTripAction } from "@/app/actions/trips";

interface PlayerDraft { name: string; hi: string }

export function NewTripForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [players, setPlayers] = useState<PlayerDraft[]>([
    { name: "", hi: "" },
    { name: "", hi: "" },
    { name: "", hi: "" },
    { name: "", hi: "" },
  ]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        setError(null);
        const cleaned = players.filter((p) => p.name.trim());
        if (cleaned.length === 0) return setError("Add at least one player.");
        start(async () => {
          const r = await createTripAction({
            name,
            destination,
            startDate,
            endDate,
            players: cleaned.map((p) => ({ name: p.name.trim(), handicapIndex: p.hi.trim() === "" ? 0 : Number(p.hi) })),
          });
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      <section className="card p-4 flex flex-col gap-3">
        <label>
          <span className="label">Trip name</span>
          <input className="field" required maxLength={80} placeholder="Pinehurst 2026" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="label">Destination</span>
          <input className="field" maxLength={80} placeholder="Pinehurst, NC" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Start</span>
            <input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            <span className="label">End</span>
            <input className="field" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Players & Handicap Index</h2>
          <button type="button" className="text-sm font-semibold text-green tap !min-h-9" onClick={() => setPlayers((p) => [...p, { name: "", hi: "" }])}>
            + Add
          </button>
        </div>
        <p className="text-xs text-muted -mt-1">First player is the trip owner. Handicap Index is entered manually in V1.</p>
        {players.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_5.5rem_2.5rem] gap-2 items-center">
            <input className="field" placeholder={`Player ${i + 1}`} maxLength={40} value={p.name} onChange={(e) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="field" inputMode="decimal" placeholder="HI" value={p.hi} onChange={(e) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, hi: e.target.value } : x)))} />
            <button type="button" className="tap text-muted" aria-label="Remove player" onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))} disabled={players.length === 1}>
              ✕
            </button>
          </div>
        ))}
      </section>

      {error && <p className="text-sm text-red">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Creating…" : "Create trip"}
      </button>
    </form>
  );
}
