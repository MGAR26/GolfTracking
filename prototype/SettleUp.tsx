/**
 * "Who owes whom" with one-tap Venmo. Each line reads "Matt owes Marcus $50"; the name of the
 * person being paid is a button that opens a small panel: pay them in Venmo with the amount and
 * a note filled in, or copy their username. The person owed can request it from the payer the
 * same way, and someone without a Venmo can add theirs right there.
 * The app never moves money itself: it only opens Venmo with the details ready.
 */
import { useState } from "react";
import { useApp } from "./App";
import { normalizeVenmo, setVenmo } from "./store";
import { money } from "../src/lib/format";

export interface Payment { fromPlayerId: string; toPlayerId: string; amountCents: number }

const amount = (cents: number) => (cents / 100).toFixed(2);
/** Opens the Venmo app on a phone (web on a computer) with recipient, amount and note filled in. */
export const venmoPayUrl = (handle: string, cents: number, note: string) => `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(handle)}&amount=${amount(cents)}&note=${encodeURIComponent(note)}`;
export const venmoRequestUrl = (handle: string, cents: number, note: string) => `https://venmo.com/?txn=charge&recipients=${encodeURIComponent(handle)}&amount=${amount(cents)}&note=${encodeURIComponent(note)}`;

function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => false);
  } catch { /* fall through */ }
  return Promise.resolve(false);
}

export function SettleUpList({ payments, note, empty = "Everyone is even." }: { payments: Payment[]; note: string; empty?: string }) {
  const { state, mutate } = useApp();
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const player = (id: string) => state.players.find((p) => p.id === id);
  const name = (id: string) => player(id)?.name ?? "Someone";
  if (payments.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line" data-testid="settle-up">
      {payments.map((p, i) => {
        const payee = player(p.toPlayerId), payer = player(p.fromPlayerId);
        const isOpen = open === i;
        const iPay = state.actorId === p.fromPlayerId, imOwed = state.actorId === p.toPlayerId;
        const doCopy = (h: string) => { void copyText(h).then((ok) => setCopied(ok ? h : `select:${h}`)); };
        return (
          <li key={`${p.fromPlayerId}-${p.toPlayerId}`} className="py-2" data-testid="settle-row">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{iPay ? "You" : name(p.fromPlayerId)}</span> {iPay ? "owe" : "owes"}{" "}
                <button type="button" onClick={() => { setOpen(isOpen ? null : i); setError(null); setDraft(""); setCopied(null); }} aria-expanded={isOpen} className="font-semibold text-accent underline decoration-dotted underline-offset-4" data-testid="payee">
                  {imOwed ? "you" : name(p.toPlayerId)}
                </button>
              </span>
              <span className="font-semibold tabular-nums">{money(p.amountCents)}</span>
            </div>
            {isOpen && (
              <div className="mt-2 rounded-lg bg-surface-2/70 p-2.5 flex flex-col gap-2 text-sm" data-testid="venmo-panel">
                {imOwed ? (
                  /* You're owed: the payer's Venmo is what you need (to request it or find them). */
                  payer?.venmo ? (
                    <>
                      <a href={venmoRequestUrl(payer.venmo, p.amountCents, note)} target="_blank" rel="noopener noreferrer" className="btn btn-primary !min-h-10 text-sm" data-testid="venmo-request">Request {money(p.amountCents)} from {name(p.fromPlayerId)}</a>
                      <HandleRow label={`${name(p.fromPlayerId)}'s Venmo`} handle={payer.venmo} copied={copied} onCopy={doCopy} />
                    </>
                  ) : (
                    <p className="text-ink-2" data-testid="venmo-missing">{name(p.fromPlayerId)} hasn&apos;t added a Venmo yet. Ask them to add it, or settle another way.</p>
                  )
                ) : payee?.venmo ? (
                  /* You pay (or you're looking at someone else's line): the payee's Venmo. */
                  <>
                    <a href={venmoPayUrl(payee.venmo, p.amountCents, note)} target="_blank" rel="noopener noreferrer" className={`btn ${iPay ? "btn-primary" : "btn-secondary"} !min-h-10 text-sm`} data-testid="venmo-pay">
                      {iPay ? `Pay ${name(p.toPlayerId)} ${money(p.amountCents)} on Venmo` : `Open ${name(p.toPlayerId)} in Venmo`}
                    </a>
                    <HandleRow label={`${name(p.toPlayerId)}'s Venmo`} handle={payee.venmo} copied={copied} onCopy={doCopy} />
                  </>
                ) : (
                  <p className="text-ink-2" data-testid="venmo-missing">{name(p.toPlayerId)} hasn&apos;t added a Venmo yet. Ask them to add it, or settle another way.</p>
                )}
                {copied?.startsWith("select:") && <p className="text-xs text-muted">Copy isn&apos;t allowed here; press and hold the username to copy it.</p>}
                {imOwed && (payee?.venmo ? (
                  <p className="text-xs text-muted flex items-center justify-between gap-2" data-testid="own-venmo">
                    <span>Your Venmo <span className="select-all">@{payee.venmo}</span></span>
                    <button type="button" className="text-accent font-semibold" onClick={() => doCopy(`@${payee.venmo}`)}>{copied === `@${payee.venmo}` ? "Copied" : "Copy yours"}</button>
                  </p>
                ) : (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setError(null); const err = mutate((s) => setVenmo(s, s.actorId, draft)); if (err) setError(err); }}>
                    <input className="field !min-h-10 flex-1" placeholder="Add your @venmo so people can pay you" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Your Venmo username" autoCapitalize="none" autoCorrect="off" />
                    <button type="submit" className="btn btn-primary !min-h-10 text-sm">Save</button>
                  </form>
                ))}
                {error && <p className="text-xs text-neg">{error}</p>}
                <p className="text-[11px] text-muted">Venmo opens with the amount and &ldquo;{note}&rdquo; filled in. You confirm it in Venmo; the app never moves money.</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Someone's Venmo username with a Copy button. */
function HandleRow({ label, handle, copied, onCopy }: { label: string; handle: string; copied: string | null; onCopy: (h: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-2">{label} <b className="text-ink select-all" data-testid="venmo-handle">@{handle}</b></span>
      <button type="button" className="btn btn-secondary !min-h-8 px-3 text-xs" onClick={() => onCopy(`@${handle}`)} data-testid="venmo-copy">{copied === `@${handle}` ? "Copied" : "Copy"}</button>
    </div>
  );
}

/** Your own Venmo username: shown on the trip's player list, editable only by you. */
export function VenmoField({ playerId }: { playerId: string }) {
  const { state, mutate } = useApp();
  const p = state.players.find((x) => x.id === playerId);
  const mine = state.actorId === playerId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p?.venmo ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!p) return null;
  if (editing) {
    return (
      <form className="col-span-2 flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); setError(null); const err = mutate((s) => setVenmo(s, s.actorId, draft)); if (err) setError(err); else setEditing(false); }}>
        <div className="flex gap-2">
          <input className="field !min-h-9 flex-1 text-sm" placeholder="@your-venmo" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Your Venmo username" autoCapitalize="none" autoCorrect="off" autoFocus />
          <button type="submit" className="btn btn-primary !min-h-9 text-xs">Save</button>
        </div>
        {error && <span className="text-xs text-neg">{error}</span>}
      </form>
    );
  }
  return p.venmo
    ? <span className="text-xs text-ink-2">@{p.venmo}{mine && <button type="button" className="ml-1.5 text-accent font-semibold" onClick={() => { setDraft(p.venmo ?? ""); setEditing(true); }}>Edit</button>}</span>
    : mine ? <button type="button" className="text-xs text-accent font-semibold" onClick={() => setEditing(true)} data-testid="add-venmo">+ Add Venmo</button> : <span className="text-xs text-muted">No Venmo</span>;
}

export { normalizeVenmo };
