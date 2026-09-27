"use client";

import { useMemo, useState, useTransition } from "react";
import { createRoundAction } from "@/app/actions/rounds";
import { calculateCourseHandicap } from "@/domain/handicap";

export interface TeeOption { teeSetId: string; label: string; par: number; courseRating: number; slopeRating: number }
export interface PlayerOption { playerId: string; displayName: string; handicapIndex: number }

const DEFAULT_PARS = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4];
const DEFAULT_SI = [7, 3, 15, 1, 11, 17, 5, 13, 9, 8, 16, 2, 12, 4, 10, 18, 6, 14];

type Side = "A" | "B";
interface GameDraft {
  stroke: { on: boolean; basis: "GROSS" | "NET"; stake: string };
  skins: { on: boolean; basis: "GROSS" | "NET"; value: string; carryover: boolean };
  nassau: { on: boolean; basis: "GROSS" | "NET"; amount: string; sides: Record<string, Side> };
  match: { on: boolean; basis: "GROSS" | "NET"; amount: string; sides: Record<string, Side> };
  stableford: { on: boolean; basis: "GROSS" | "NET"; stake: string };
  bestBall: { on: boolean; basis: "GROSS" | "NET"; stake: string; sides: Record<string, Side> };
}

export function NewRoundForm({ tripId, tees, players }: { tripId: string; tees: TeeOption[]; players: PlayerOption[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [courseMode, setCourseMode] = useState<"existing" | "manual">(tees.length ? "existing" : "manual");
  const [teeSetId, setTeeSetId] = useState(tees[0]?.teeSetId ?? "");
  const [courseName, setCourseName] = useState("");
  const [teeName, setTeeName] = useState("White");
  const [rating, setRating] = useState("72.0");
  const [slope, setSlope] = useState("125");
  const [holes, setHoles] = useState(DEFAULT_PARS.map((par, i) => ({ par: String(par), yardage: "", si: String(DEFAULT_SI[i]) })));
  const [selected, setSelected] = useState<string[]>(players.map((p) => p.playerId));
  const [counts, setCounts] = useState(true);
  const [mode, setMode] = useState<"HYBRID" | "GROUP_SCORER" | "INDIVIDUAL">("HYBRID");
  const [scorer, setScorer] = useState(players[0]?.playerId ?? "");
  const defaultSides = () => Object.fromEntries(players.map((p, i) => [p.playerId, i % 2 === 0 ? "A" : "B"])) as Record<string, Side>;
  const [games, setGames] = useState<GameDraft>({
    stroke: { on: true, basis: "NET", stake: "0" },
    skins: { on: true, basis: "NET", value: "5", carryover: true },
    nassau: { on: false, basis: "NET", amount: "20", sides: defaultSides() },
    match: { on: false, basis: "NET", amount: "10", sides: defaultSides() },
    stableford: { on: false, basis: "NET", stake: "0" },
    bestBall: { on: false, basis: "NET", stake: "10", sides: defaultSides() },
  });

  const tee = tees.find((t) => t.teeSetId === teeSetId);
  const preview = useMemo(() => {
    const par = courseMode === "existing" ? tee?.par : holes.reduce((a, h) => a + (Number(h.par) || 0), 0);
    const cr = courseMode === "existing" ? tee?.courseRating : Number(rating);
    const sl = courseMode === "existing" ? tee?.slopeRating : Number(slope);
    if (!par || !cr || !sl || sl < 55 || sl > 155) return null;
    return players
      .filter((p) => selected.includes(p.playerId))
      .map((p) => ({ ...p, ch: calculateCourseHandicap({ handicapIndex: p.handicapIndex, slopeRating: sl, courseRating: cr, par }).courseHandicap }));
  }, [courseMode, tee, holes, rating, slope, players, selected]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const cents = (v: string) => Math.round((Number(v) || 0) * 100);
  const sideIds = (sides: Record<string, Side>, side: Side) => selected.filter((id) => (sides[id] ?? "A") === side);

  function submit() {
    setError(null);
    const gameList: { type: string; name: string; rules: Record<string, unknown>; teams?: { name: string; playerIds: string[] }[] }[] = [];
    if (games.stroke.on) gameList.push({ type: "STROKE_PLAY", name: `${games.stroke.basis === "NET" ? "Net" : "Gross"} Stroke Play`, rules: { basis: games.stroke.basis, stakeCents: cents(games.stroke.stake) } });
    if (games.skins.on) gameList.push({ type: "SKINS", name: `$${games.skins.value} Skins`, rules: { basis: games.skins.basis, skinValueCents: cents(games.skins.value), carryover: games.skins.carryover, voidUnclaimed: true } });
    if (games.nassau.on) gameList.push({ type: "NASSAU", name: `$${games.nassau.amount} Nassau`, rules: { basis: games.nassau.basis, amountCents: cents(games.nassau.amount), sideA: sideIds(games.nassau.sides, "A"), sideB: sideIds(games.nassau.sides, "B"), presses: false } });
    if (games.match.on) gameList.push({ type: "MATCH_PLAY", name: "Match Play", rules: { basis: games.match.basis, amountCents: cents(games.match.amount), sideA: sideIds(games.match.sides, "A"), sideB: sideIds(games.match.sides, "B") } });
    if (games.stableford.on) gameList.push({ type: "STABLEFORD", name: "Stableford", rules: { basis: games.stableford.basis, stakeCents: cents(games.stableford.stake) } });
    if (games.bestBall.on)
      gameList.push({
        type: "BEST_BALL",
        name: "Best Ball",
        rules: { basis: games.bestBall.basis, stakeCents: cents(games.bestBall.stake) },
        teams: [
          { name: "Team A", playerIds: sideIds(games.bestBall.sides, "A") },
          { name: "Team B", playerIds: sideIds(games.bestBall.sides, "B") },
        ],
      });
    start(async () => {
      const r = await createRoundAction({
        tripId,
        name,
        startsAt,
        countsTowardTrip: counts,
        scoringMode: mode,
        scorerPlayerId: mode === "INDIVIDUAL" ? null : scorer,
        playerIds: selected,
        course:
          courseMode === "existing"
            ? { mode: "existing", teeSetId }
            : {
                mode: "manual",
                name: courseName,
                teeName,
                courseRating: Number(rating),
                slopeRating: Number(slope),
                holes: holes.map((h, i) => ({ holeNumber: i + 1, par: Number(h.par), yardage: h.yardage === "" ? null : Number(h.yardage), strokeIndex: Number(h.si) })),
              },
        games: gameList,
      });
      if (r && !r.ok) setError(r.error);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <section className="card p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Course & tees</h2>
        {tees.length > 0 && (
          <div className="seg">
            <button type="button" aria-pressed={courseMode === "existing"} onClick={() => setCourseMode("existing")}>Saved course</button>
            <button type="button" aria-pressed={courseMode === "manual"} onClick={() => setCourseMode("manual")}>Enter manually</button>
          </div>
        )}
        {courseMode === "existing" ? (
          <label>
            <span className="label">Course / tee</span>
            <select className="field" value={teeSetId} onChange={(e) => setTeeSetId(e.target.value)}>
              {tees.map((t) => (
                <option key={t.teeSetId} value={t.teeSetId}>{t.label} · par {t.par} · {t.courseRating}/{t.slopeRating}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              <span className="label">Course name</span>
              <input className="field" required placeholder="Pinehurst No. 4" value={courseName} onChange={(e) => setCourseName(e.target.value)} />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label>
                <span className="label">Tee</span>
                <input className="field" value={teeName} onChange={(e) => setTeeName(e.target.value)} />
              </label>
              <label>
                <span className="label">Rating</span>
                <input className="field" inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} />
              </label>
              <label>
                <span className="label">Slope</span>
                <input className="field" inputMode="numeric" value={slope} onChange={(e) => setSlope(e.target.value)} />
              </label>
            </div>
            <details>
              <summary className="text-sm font-semibold text-green cursor-pointer">Holes (par {holes.reduce((a, h) => a + (Number(h.par) || 0), 0)}) — edit par, yardage, stroke index</summary>
              <div className="mt-2 grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 text-xs items-center">
                <span className="text-muted">#</span><span className="text-muted">Par</span><span className="text-muted">Yds</span><span className="text-muted">SI</span>
                {holes.map((h, i) => (
                  <HoleRow key={i} i={i} h={h} onChange={(patch) => setHoles((hs) => hs.map((x, j) => (j === i ? { ...x, ...patch } : x)))} />
                ))}
              </div>
            </details>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="label">Round name</span>
            <input className="field" placeholder="Round 1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="label">Tee time</span>
            <input className="field" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="card p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Players</h2>
        <p className="text-xs text-muted -mt-1">Handicap Index is snapshotted now; Course Handicap is computed from the selected tees.</p>
        {players.map((p) => {
          const on = selected.includes(p.playerId);
          const ch = preview?.find((x) => x.playerId === p.playerId)?.ch;
          return (
            <button key={p.playerId} type="button" aria-pressed={on} onClick={() => toggle(p.playerId)} className={`tap flex items-center justify-between rounded-xl border px-3 text-left ${on ? "border-green bg-green-soft/60" : "border-line"}`}>
              <span className="font-medium">{p.displayName}</span>
              <span className="text-xs text-ink-2">HI {p.handicapIndex.toFixed(1)}{on && ch !== undefined ? ` → CH ${ch}` : ""}</span>
            </button>
          );
        })}
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Format</h2>
        <label className="flex items-center justify-between tap">
          <span className="font-medium">Counts toward trip standings</span>
          <input type="checkbox" className="h-6 w-6 accent-[var(--green)]" checked={counts} onChange={(e) => setCounts(e.target.checked)} />
        </label>
        <div>
          <span className="label">Scoring mode</span>
          <div className="seg">
            <button type="button" aria-pressed={mode === "HYBRID"} onClick={() => setMode("HYBRID")}>Hybrid</button>
            <button type="button" aria-pressed={mode === "GROUP_SCORER"} onClick={() => setMode("GROUP_SCORER")}>Group scorer</button>
            <button type="button" aria-pressed={mode === "INDIVIDUAL"} onClick={() => setMode("INDIVIDUAL")}>Individual</button>
          </div>
          <p className="text-xs text-muted mt-1">
            {mode === "HYBRID" ? "Everyone enters their own; the scorer and organizers can enter for anyone." : mode === "GROUP_SCORER" ? "One scorer enters all scores." : "Each player enters only their own score."}
          </p>
        </div>
        {mode !== "INDIVIDUAL" && (
          <label>
            <span className="label">Scorer</span>
            <select className="field" value={scorer} onChange={(e) => setScorer(e.target.value)}>
              {players.filter((p) => selected.includes(p.playerId)).map((p) => (
                <option key={p.playerId} value={p.playerId}>{p.displayName}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="card p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Games</h2>
        <GameToggle label="Stroke play" on={games.stroke.on} onToggle={() => setGames((g) => ({ ...g, stroke: { ...g.stroke, on: !g.stroke.on } }))}>
          <BasisPicker value={games.stroke.basis} onChange={(basis) => setGames((g) => ({ ...g, stroke: { ...g.stroke, basis } }))} />
          <Money label="Stake per player ($, 0 = none)" value={games.stroke.stake} onChange={(stake) => setGames((g) => ({ ...g, stroke: { ...g.stroke, stake } }))} />
        </GameToggle>
        <GameToggle label="Skins" on={games.skins.on} onToggle={() => setGames((g) => ({ ...g, skins: { ...g.skins, on: !g.skins.on } }))}>
          <BasisPicker value={games.skins.basis} onChange={(basis) => setGames((g) => ({ ...g, skins: { ...g.skins, basis } }))} />
          <Money label="Skin value ($, from each other player)" value={games.skins.value} onChange={(value) => setGames((g) => ({ ...g, skins: { ...g.skins, value } }))} />
          <label className="flex items-center justify-between tap text-sm">
            <span>Carryovers</span>
            <input type="checkbox" className="h-5 w-5 accent-[var(--green)]" checked={games.skins.carryover} onChange={(e) => setGames((g) => ({ ...g, skins: { ...g.skins, carryover: e.target.checked } }))} />
          </label>
        </GameToggle>
        <GameToggle label="Nassau" on={games.nassau.on} onToggle={() => setGames((g) => ({ ...g, nassau: { ...g.nassau, on: !g.nassau.on } }))}>
          <BasisPicker value={games.nassau.basis} onChange={(basis) => setGames((g) => ({ ...g, nassau: { ...g.nassau, basis } }))} />
          <Money label="Amount per segment ($)" value={games.nassau.amount} onChange={(amount) => setGames((g) => ({ ...g, nassau: { ...g.nassau, amount } }))} />
          <SidePicker players={players.filter((p) => selected.includes(p.playerId))} sides={games.nassau.sides} onChange={(sides) => setGames((g) => ({ ...g, nassau: { ...g.nassau, sides } }))} />
        </GameToggle>
        <GameToggle label="Match play" on={games.match.on} onToggle={() => setGames((g) => ({ ...g, match: { ...g.match, on: !g.match.on } }))}>
          <BasisPicker value={games.match.basis} onChange={(basis) => setGames((g) => ({ ...g, match: { ...g.match, basis } }))} />
          <Money label="Amount ($)" value={games.match.amount} onChange={(amount) => setGames((g) => ({ ...g, match: { ...g.match, amount } }))} />
          <SidePicker players={players.filter((p) => selected.includes(p.playerId))} sides={games.match.sides} onChange={(sides) => setGames((g) => ({ ...g, match: { ...g.match, sides } }))} />
        </GameToggle>
        <GameToggle label="Stableford" on={games.stableford.on} onToggle={() => setGames((g) => ({ ...g, stableford: { ...g.stableford, on: !g.stableford.on } }))}>
          <BasisPicker value={games.stableford.basis} onChange={(basis) => setGames((g) => ({ ...g, stableford: { ...g.stableford, basis } }))} />
          <Money label="Stake per player ($)" value={games.stableford.stake} onChange={(stake) => setGames((g) => ({ ...g, stableford: { ...g.stableford, stake } }))} />
        </GameToggle>
        <GameToggle label="Best ball (teams)" on={games.bestBall.on} onToggle={() => setGames((g) => ({ ...g, bestBall: { ...g.bestBall, on: !g.bestBall.on } }))}>
          <BasisPicker value={games.bestBall.basis} onChange={(basis) => setGames((g) => ({ ...g, bestBall: { ...g.bestBall, basis } }))} />
          <Money label="Stake per player ($)" value={games.bestBall.stake} onChange={(stake) => setGames((g) => ({ ...g, bestBall: { ...g.bestBall, stake } }))} />
          <SidePicker players={players.filter((p) => selected.includes(p.playerId))} sides={games.bestBall.sides} onChange={(sides) => setGames((g) => ({ ...g, bestBall: { ...g.bestBall, sides } }))} labels={["Team A", "Team B"]} />
        </GameToggle>
      </section>

      {error && <p className="text-sm text-red">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={pending || selected.length === 0}>
        {pending ? "Starting…" : "Start round"}
      </button>
    </form>
  );
}

function HoleRow({ i, h, onChange }: { i: number; h: { par: string; yardage: string; si: string }; onChange: (p: Partial<{ par: string; yardage: string; si: string }>) => void }) {
  return (
    <>
      <span className="font-semibold">{i + 1}</span>
      <input className="field !min-h-10 !px-2" inputMode="numeric" value={h.par} onChange={(e) => onChange({ par: e.target.value })} aria-label={`Hole ${i + 1} par`} />
      <input className="field !min-h-10 !px-2" inputMode="numeric" value={h.yardage} placeholder="–" onChange={(e) => onChange({ yardage: e.target.value })} aria-label={`Hole ${i + 1} yardage`} />
      <input className="field !min-h-10 !px-2" inputMode="numeric" value={h.si} onChange={(e) => onChange({ si: e.target.value })} aria-label={`Hole ${i + 1} stroke index`} />
    </>
  );
}

function GameToggle({ label, on, onToggle, children }: { label: string; on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 ${on ? "border-green" : "border-line"}`}>
      <label className="flex items-center justify-between tap">
        <span className="font-medium">{label}</span>
        <input type="checkbox" className="h-6 w-6 accent-[var(--green)]" checked={on} onChange={onToggle} />
      </label>
      {on && <div className="mt-2 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function BasisPicker({ value, onChange }: { value: "GROSS" | "NET"; onChange: (v: "GROSS" | "NET") => void }) {
  return (
    <div className="seg">
      <button type="button" aria-pressed={value === "NET"} onClick={() => onChange("NET")}>Net</button>
      <button type="button" aria-pressed={value === "GROSS"} onClick={() => onChange("GROSS")}>Gross</button>
    </div>
  );
}

function Money({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input className="field" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SidePicker({ players, sides, onChange, labels = ["Side A", "Side B"] }: { players: PlayerOption[]; sides: Record<string, Side>; onChange: (s: Record<string, Side>) => void; labels?: [string, string] | string[] }) {
  return (
    <div className="flex flex-col gap-1">
      {players.map((p) => (
        <div key={p.playerId} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
          <span>{p.displayName}</span>
          <div className="seg w-40">
            <button type="button" aria-pressed={(sides[p.playerId] ?? "A") === "A"} onClick={() => onChange({ ...sides, [p.playerId]: "A" })}>{labels[0]}</button>
            <button type="button" aria-pressed={sides[p.playerId] === "B"} onClick={() => onChange({ ...sides, [p.playerId]: "B" })}>{labels[1]}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
