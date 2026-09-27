"use client";

import { useState, useTransition } from "react";
import { acceptSideBetAction, createSideBetAction, declineSideBetAction, resolveSideBetAction } from "@/app/actions/sideBets";
import { SIDE_BET_PRESETS } from "@/domain/side-bets";
import type { ProjectedSideBet } from "@/server/services/roundProjection";
import { money } from "@/lib/format";
import { Pill } from "./ui";

interface PlayerLite { playerId: string; displayName: string }

export function SideBetList({ roundId, bets, players, actorId, canOrganize, live }: { roundId: string; bets: ProjectedSideBet[]; players: PlayerLite[]; actorId: string; canOrganize: boolean; live: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => players.find((p) => p.playerId === id)?.displayName ?? "?";
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
    });

  if (bets.length === 0) return <p className="text-sm text-muted">No side bets yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {error && <li className="text-sm text-neg">{error}</li>}
      {bets.map((b) => {
        const sideA = b.participants.filter((p) => p.side === "A");
        const sideB = b.participants.filter((p) => p.side === "B");
        const me = b.participants.find((p) => p.playerId === actorId);
        const canAccept = b.status === "PROPOSED" && me && me.playerId !== b.creatorId && !me.acceptedAt;
        const canResolve = live && b.status === "ACCEPTED" && (canOrganize || !!me);
        const tone = b.status === "SETTLED" ? "green" : b.status === "ACCEPTED" ? "gold" : b.status === "PROPOSED" ? "neutral" : "red";
        return (
          <li key={b.id} className="rounded-xl border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold leading-tight">{b.terms.description}</p>
                <p className="text-xs text-muted mt-0.5">
                  {sideA.map((p) => name(p.playerId)).join(" & ")} vs {sideB.map((p) => name(p.playerId)).join(" & ")} · {money(b.terms.amountCents)}
                  {b.terms.holeNumbers.length ? ` · hole${b.terms.holeNumbers.length > 1 ? "s" : ""} ${b.terms.holeNumbers.join(", ")}` : ""}
                </p>
              </div>
              <Pill tone={tone}>{b.status === "PROPOSED" ? "Awaiting" : b.status.charAt(0) + b.status.slice(1).toLowerCase()}</Pill>
            </div>
            {b.status === "PROPOSED" && (
              <p className="text-xs text-ink-2 mt-1">Waiting on {b.participants.filter((p) => !p.acceptedAt).map((p) => name(p.playerId)).join(", ")}</p>
            )}
            {b.resolution && (
              <p className="text-xs text-ink-2 mt-1">{b.resolution.winnerPlayerId ? `Winner: ${name(b.resolution.winnerPlayerId)}` : "Tied · void"}</p>
            )}
            {(canAccept || canResolve || (b.status === "PROPOSED" && me)) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {canAccept && (
                  <button className="btn btn-primary !min-h-10 text-sm" disabled={pending} onClick={() => run(() => acceptSideBetAction(roundId, b.id))}>
                    Accept
                  </button>
                )}
                {b.status === "PROPOSED" && me && (
                  <button className="btn btn-secondary !min-h-10 text-sm" disabled={pending} onClick={() => run(() => declineSideBetAction(roundId, b.id))}>
                    {me.playerId === b.creatorId ? "Cancel" : "Decline"}
                  </button>
                )}
                {canResolve && b.autoResult && (
                  <button className="btn btn-primary !min-h-10 text-sm" disabled={pending} onClick={() => run(() => resolveSideBetAction(roundId, b.id, "AUTO"))}>
                    Resolve from scores ({b.autoResult === "TIE" ? "tie" : name(b.participants.find((p) => p.side === b.autoResult)!.playerId)})
                  </button>
                )}
                {canResolve && (
                  <>
                    <button className="btn btn-secondary !min-h-10 text-sm" disabled={pending} onClick={() => run(() => resolveSideBetAction(roundId, b.id, "A"))}>
                      {sideA.map((p) => name(p.playerId)).join(" & ")} won
                    </button>
                    <button className="btn btn-secondary !min-h-10 text-sm" disabled={pending} onClick={() => run(() => resolveSideBetAction(roundId, b.id, "B"))}>
                      {sideB.map((p) => name(p.playerId)).join(" & ")} won
                    </button>
                    <button className="btn btn-ghost !min-h-10 text-sm" disabled={pending} onClick={() => run(() => resolveSideBetAction(roundId, b.id, "TIE"))}>
                      Tie / void
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function NewSideBetForm({ roundId, players, actorId, defaultHole }: { roundId: string; players: PlayerLite[]; actorId: string; defaultHole: number | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>("LONGEST_DRIVE_IN_FAIRWAY");
  const [opponents, setOpponents] = useState<string[]>([]);
  const [amount, setAmount] = useState("20");
  const [holes, setHoles] = useState(defaultHole ? String(defaultHole) : "");
  const [basis, setBasis] = useState<"GROSS" | "NET">("GROSS");
  const [description, setDescription] = useState("");
  const preset = SIDE_BET_PRESETS.find((p) => p.type === type)!;
  const opponentsAvailable = players.filter((p) => p.playerId !== actorId);

  if (!open)
    return (
      <button type="button" className="btn btn-secondary w-full" onClick={() => setOpen(true)}>
        + Side bet
      </button>
    );

  const holeNumbers = holes
    .split(/[ ,]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 18);
  const finalDescription = description.trim() || `${preset.label}${holeNumbers.length ? ` - Hole ${holeNumbers.join(", ")}` : ""}`;

  return (
    <form
      className="card p-4 flex flex-col gap-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        setError(null);
        start(async () => {
          const r = await createSideBetAction({
            roundId,
            type: type as never,
            description: finalDescription,
            amountCents: Math.round(Number(amount) * 100),
            basis,
            holeNumbers,
            opponentIds: opponents,
          });
          if (!r.ok) setError(r.error);
          else {
            setOpen(false);
            setOpponents([]);
            setDescription("");
          }
        });
      }}
    >
      <h3 className="font-display text-lg">New side bet</h3>
      <label>
        <span className="label">Bet type</span>
        <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
          {SIDE_BET_PRESETS.map((p) => (
            <option key={p.type} value={p.type}>{p.label}</option>
          ))}
        </select>
      </label>
      <div>
        <span className="label">Opponent(s)</span>
        <div className="flex flex-wrap gap-2">
          {opponentsAvailable.map((p) => {
            const on = opponents.includes(p.playerId);
            return (
              <button key={p.playerId} type="button" aria-pressed={on} onClick={() => setOpponents((o) => (on ? o.filter((x) => x !== p.playerId) : [...o, p.playerId]))} className={`tap rounded-full px-4 text-sm font-semibold border ${on ? "bg-accent text-white border-accent" : "bg-surface border-line-strong"}`}>
                {p.displayName}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">Amount ($)</span>
          <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          <span className="label">Hole(s)</span>
          <input className="field" inputMode="numeric" placeholder="e.g. 8 or 10,11,12" value={holes} onChange={(e) => setHoles(e.target.value)} />
        </label>
      </div>
      {preset.autoResolvable && (
        <div>
          <span className="label">Scoring</span>
          <div className="seg">
            <button type="button" aria-pressed={basis === "GROSS"} onClick={() => setBasis("GROSS")}>Gross</button>
            <button type="button" aria-pressed={basis === "NET"} onClick={() => setBasis("NET")}>Net</button>
          </div>
        </div>
      )}
      <label>
        <span className="label">Description</span>
        <input className="field" placeholder={finalDescription} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <p className="text-xs text-muted">Extra — separate from existing games. Terms lock once every opponent accepts.</p>
      {error && <p className="text-sm text-neg">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={pending || opponents.length === 0}>Send bet</button>
      </div>
    </form>
  );
}
