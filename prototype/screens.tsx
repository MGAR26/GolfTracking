import { useState } from "react";
import { useApp, AppHeader, RoundTabs, type Route } from "./App";
import { Button, Card, GameCard, Leaderboard, Page, Pill, Scorecard, StrokeDots, TextLink, ToPar } from "./ui";
import { HoleView, TRAIL_COLORS } from "./HoleView";
import { ShotLog, BagCard, ShotFilterControl } from "./ShotLog";
import { addShotByDistance, clubForRemaining, deleteShot, groupMates, holeOut, holeShapeFor, holeShots, deleteRound, logPutt, logShot, markBall, moveShotRest, pendingAim, replaceHoleShots, setCourseGeometry, setPendingAim, setShotDistance, setShotFilter, updateShot } from "./store";
import type { State } from "./store";
import type { Shot } from "./shots";
import { dist } from "./holeGeometry";
import { fetchRealCourse } from "./osmCourse";
import {
  acceptSideBet, createRound, createSideBet, createTrip, declineSideBet, findScore, finishProblems, finishRound, nameOf, reopenRound, resolveSideBet, roundSnapshot, saveScore, tripDashboard, tripRole,
  SEED_HOLES, liveMoney, setScorecardView, type ScorecardView, type Snapshot,
} from "./store";
import { canEditScore } from "../src/server/services/permissions";
import { SIDE_BET_PRESETS, type SideBetType } from "../src/domain/side-bets";
import { calculateCourseHandicap } from "../src/domain/handicap";
import type { HoleEntry } from "../src/domain/types";
import { formatDateRange, formatTime, money, plural } from "../src/lib/format";

/* ================= Home ================= */
export function HomeScreen() {
  const { state, nav } = useApp();
  return (
    <>
      <AppHeader title="Golf Trip OS" subtitle="Trips" showBack={false} />
      <Page>
        <ul className="flex flex-col gap-3">
          {state.trips.map((t) => {
            const live = state.rounds.find((r) => r.tripId === t.id && r.status === "LIVE");
            return (
              <li key={t.id}>
                <button type="button" onClick={() => nav({ name: "trip", tripId: t.id })} className="card block w-full text-left p-4 active:scale-[0.99] transition-transform">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-display text-xl leading-tight truncate">{t.name}</h2>
                      <p className="text-sm text-muted mt-0.5">{[t.destination, formatDateRange(t.startDate, t.endDate)].filter(Boolean).join(" · ")}</p>
                    </div>
                    {live && <Pill tone="green">Live</Pill>}
                  </div>
                  <p className="text-xs text-ink-2 mt-2">{plural(t.playerIds.length, "player")} · {plural(state.rounds.filter((r) => r.tripId === t.id).length, "round")}</p>
                </button>
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" onClick={() => nav({ name: "newTrip" })}>New trip</Button>
      </Page>
    </>
  );
}

/* ================= New trip ================= */
export function NewTripScreen() {
  const { mutate, nav } = useApp();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [players, setPlayers] = useState([{ name: "", hi: "" }, { name: "", hi: "" }, { name: "", hi: "" }, { name: "", hi: "" }]);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <AppHeader title="New trip" showBack />
      <Page>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const cleaned = players.filter((p) => p.name.trim());
            if (!name.trim()) return setError("Trip name is required.");
            if (cleaned.length === 0) return setError("Add at least one player.");
            let id = "";
            const err = mutate((s) => { id = createTrip(s, { name: name.trim(), destination, startDate, endDate, players: cleaned.map((p) => ({ name: p.name.trim(), handicapIndex: p.hi.trim() === "" ? 0 : Number(p.hi) })) }); });
            if (err) return setError(err);
            nav({ name: "trip", tripId: id });
          }}
        >
          <section className="card p-4 flex flex-col gap-3">
            <label><span className="label">Trip name</span><input className="field" placeholder="Bandon 2027" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label><span className="label">Destination</span><input className="field" placeholder="Bandon, OR" value={destination} onChange={(e) => setDestination(e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Start</span><input className="field" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
              <label><span className="label">End</span><input className="field" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
            </div>
          </section>
          <section className="card p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Players & Handicap Index</h2>
              <TextLink onClick={() => setPlayers((p) => [...p, { name: "", hi: "" }])}>+ Add</TextLink>
            </div>
            <p className="text-xs text-muted -mt-1">First player is the trip owner.</p>
            {players.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_5.5rem_2.5rem] gap-2 items-center">
                <input className="field" placeholder={`Player ${i + 1}`} value={p.name} onChange={(e) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="field" inputMode="decimal" placeholder="HI" value={p.hi} onChange={(e) => setPlayers((ps) => ps.map((x, j) => (j === i ? { ...x, hi: e.target.value } : x)))} />
                <button type="button" className="tap text-muted" aria-label="Remove" onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))} disabled={players.length === 1}>✕</button>
              </div>
            ))}
          </section>
          {error && <p className="text-sm text-neg">{error}</p>}
          <Button type="submit">Create trip</Button>
        </form>
      </Page>
    </>
  );
}

/* ================= Trip dashboard ================= */
export function TripScreen({ tripId }: { tripId: string }) {
  const { state, nav } = useApp();
  const d = tripDashboard(state, tripId);
  const me = d.standings.find((s) => s.playerId === state.actorId);
  const anyCounted = d.standings.some((s) => s.roundsCounted > 0);
  const lastLocked = [...d.recaps].reverse().find((r) => r.round.status === "LOCKED");
  return (
    <>
      <AppHeader title={d.trip.name} subtitle={[d.trip.destination, formatDateRange(d.trip.startDate, d.trip.endDate)].filter(Boolean).join(" · ")} showBack />
      <Page>
        {d.liveRound ? (
          <Card className="!bg-ink !border-ink !border-t-brass text-[var(--bg)]">
            <p className="text-xs uppercase tracking-wide opacity-80">Live now</p>
            <h2 className="font-display text-2xl mt-1">{d.liveRound.name}</h2>
            <p className="text-sm opacity-90">{d.recaps.find((r) => r.round.id === d.liveRound!.id)?.course.name}{d.liveRound.startsAt ? ` · ${formatTime(d.liveRound.startsAt)}` : ""}{!d.liveRound.countsTowardTrip ? " · standalone" : ""}</p>
            <button type="button" onClick={() => nav({ name: "round", roundId: d.liveRound!.id, tab: "score" })} className="btn btn-secondary w-full mt-3 !text-ink">Continue scoring</button>
          </Card>
        ) : (
          <Button onClick={() => nav({ name: "newRound", tripId })}>Add round</Button>
        )}

        <Card title="Trip standings" action={<span className="text-xs text-muted">{anyCounted ? "Net · counted rounds" : "No rounds locked yet"}</span>}>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted">
              <tr><th className="text-left font-semibold py-1">Player</th><th className="text-right font-semibold py-1">Rds</th><th className="text-right font-semibold py-1">Gross</th><th className="text-right font-semibold py-1">Net</th><th className="text-right font-semibold py-1">Money</th></tr>
            </thead>
            <tbody>
              {d.standings.map((s, i) => (
                <tr key={s.playerId} className={`border-t border-line ${s.playerId === state.actorId ? "bg-tint/50" : ""}`}>
                  <td className="py-2 font-medium"><span className="text-muted mr-2">{s.roundsCounted ? i + 1 : "–"}</span>{s.displayName}</td>
                  <td className="py-2 text-right text-ink-2">{s.roundsCounted}</td>
                  <td className="py-2 text-right">{s.roundsCounted ? <><span className="font-semibold">{s.totalGross}</span> <ToPar value={s.grossToPar} className="text-xs" /></> : "–"}</td>
                  <td className="py-2 text-right">{s.roundsCounted ? <><span className="font-semibold">{s.totalNet}</span> <ToPar value={s.netToPar} className="text-xs" /></> : "–"}</td>
                  <td className={`py-2 text-right font-semibold ${s.moneyCents > 0 ? "text-ink" : s.moneyCents < 0 ? "text-neg" : "text-muted"}`}>{money(s.moneyCents, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {me && (
            <p className="text-xs text-muted mt-2">
              You are {me.moneyCents === 0 ? "even" : me.moneyCents > 0 ? `up ${money(me.moneyCents)}` : `down ${money(-me.moneyCents)}`} · <TextLink className="!text-xs" onClick={() => nav({ name: "money", tripId })}>Money & settlement</TextLink>
            </p>
          )}
        </Card>

        {lastLocked && (
          <Card title="Previous round">
            <button type="button" onClick={() => nav({ name: "round", roundId: lastLocked.round.id, tab: "overview" })} className="flex w-full items-center justify-between text-left">
              <div>
                <p className="font-medium">{lastLocked.round.name}</p>
                <p className="text-xs text-muted">{lastLocked.leader ? `${lastLocked.leader} led on net` : "Locked"}{lastLocked.round.countsTowardTrip ? "" : " · standalone"}</p>
              </div>
              <span className="text-accent text-sm font-semibold">Recap ›</span>
            </button>
          </Card>
        )}

        <Card title="Rounds" action={<TextLink onClick={() => nav({ name: "newRound", tripId })}>+ Add</TextLink>}>
          {d.recaps.length === 0 ? (
            <p className="text-sm text-muted">No rounds yet. Add the first one to snapshot handicaps and pick games.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.recaps.map((r) => (
                <li key={r.round.id}>
                  <button type="button" onClick={() => nav({ name: "round", roundId: r.round.id, tab: "overview" })} className="flex w-full items-center justify-between py-2.5 text-left">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.round.name}</p>
                      <p className="text-xs text-muted">{r.course.name} · {r.course.teeName}{r.round.startsAt ? ` · ${formatTime(r.round.startsAt)}` : ""}{r.round.status === "LIVE" ? ` · thru ${r.holesComplete}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!r.round.countsTowardTrip && <Pill>Standalone</Pill>}
                      <Pill tone={r.round.status === "LIVE" ? "green" : "neutral"}>{r.round.status === "LOCKED" ? "Final" : "Live"}</Pill>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Players">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {d.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2"><span className="font-medium">{m.name}</span><span className="text-xs text-ink-2">HI {m.handicapIndex.toFixed(1)}</span></li>
            ))}
          </ul>
        </Card>
      </Page>
    </>
  );
}

/* ================= New round ================= */
type Side = "A" | "B";
export function NewRoundScreen({ tripId }: { tripId: string }) {
  const { state, mutate, nav } = useApp();
  const trip = state.trips.find((t) => t.id === tripId)!;
  const players = trip.playerIds.map((id) => state.players.find((p) => p.id === id)!);
  const [courseId, setCourseId] = useState(state.courses[0]?.id ?? "manual");
  const [courseName, setCourseName] = useState("");
  const [rating, setRating] = useState("72.0");
  const [slope, setSlope] = useState("125");
  const [name, setName] = useState(`Round ${state.rounds.filter((r) => r.tripId === tripId).length + 1}`);
  const [selected, setSelected] = useState<string[]>(players.map((p) => p.id));
  const [counts, setCounts] = useState(true);
  const [mode, setMode] = useState<"HYBRID" | "GROUP_SCORER" | "INDIVIDUAL">("HYBRID");
  const [scorer, setScorer] = useState(players[0]?.id ?? "");
  const defaultSides = () => Object.fromEntries(players.map((p, i) => [p.id, i % 2 === 0 ? "A" : "B"])) as Record<string, Side>;
  const [g, setG] = useState({
    stroke: { on: true, basis: "NET" as "NET" | "GROSS", stake: "0" },
    skins: { on: true, basis: "NET" as "NET" | "GROSS", value: "5", carryover: true },
    nassau: { on: false, basis: "NET" as "NET" | "GROSS", amount: "20", sides: defaultSides() },
    match: { on: false, basis: "NET" as "NET" | "GROSS", amount: "10", sides: defaultSides() },
    stableford: { on: false, basis: "NET" as "NET" | "GROSS", stake: "0" },
    bestBall: { on: false, basis: "NET" as "NET" | "GROSS", stake: "10", sides: defaultSides() },
  });
  const [error, setError] = useState<string | null>(null);
  const course = state.courses.find((c) => c.id === courseId);
  const par = course ? course.par : 72;
  const cr = course ? course.courseRating : Number(rating);
  const sl = course ? course.slopeRating : Number(slope);
  const chFor = (hi: number) => (sl >= 55 && sl <= 155 && cr ? calculateCourseHandicap({ handicapIndex: hi, slopeRating: sl, courseRating: cr, par }).courseHandicap : null);
  const cents = (v: string) => Math.round((Number(v) || 0) * 100);
  const sideIds = (sides: Record<string, Side>, side: Side) => selected.filter((id) => (sides[id] ?? "A") === side);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  function submit() {
    setError(null);
    const games: { type: string; name: string; rules: Record<string, unknown>; teams?: { name: string; playerIds: string[] }[] }[] = [];
    if (g.stroke.on) games.push({ type: "STROKE_PLAY", name: `${g.stroke.basis === "NET" ? "Net" : "Gross"} Stroke Play`, rules: { basis: g.stroke.basis, stakeCents: cents(g.stroke.stake) } });
    if (g.skins.on) games.push({ type: "SKINS", name: `$${g.skins.value} Skins`, rules: { basis: g.skins.basis, skinValueCents: cents(g.skins.value), carryover: g.skins.carryover, voidUnclaimed: true } });
    if (g.nassau.on) games.push({ type: "NASSAU", name: `$${g.nassau.amount} Nassau`, rules: { basis: g.nassau.basis, amountCents: cents(g.nassau.amount), sideA: sideIds(g.nassau.sides, "A"), sideB: sideIds(g.nassau.sides, "B"), presses: false } });
    if (g.match.on) games.push({ type: "MATCH_PLAY", name: "Match Play", rules: { basis: g.match.basis, amountCents: cents(g.match.amount), sideA: sideIds(g.match.sides, "A"), sideB: sideIds(g.match.sides, "B") } });
    if (g.stableford.on) games.push({ type: "STABLEFORD", name: "Stableford", rules: { basis: g.stableford.basis, stakeCents: cents(g.stableford.stake) } });
    if (g.bestBall.on) games.push({ type: "BEST_BALL", name: "Best Ball", rules: { basis: g.bestBall.basis, stakeCents: cents(g.bestBall.stake) }, teams: [{ name: "Team A", playerIds: sideIds(g.bestBall.sides, "A") }, { name: "Team B", playerIds: sideIds(g.bestBall.sides, "B") }] });
    if (selected.length === 0) return setError("Pick at least one player.");
    if (!course && !courseName.trim()) return setError("Course name is required.");
    let id = "";
    const err = mutate((s) => {
      id = createRound(s, {
        tripId, courseId: course?.id, manualCourse: course ? undefined : { name: courseName.trim(), teeName: "White", courseRating: Number(rating), slopeRating: Number(slope), holes: SEED_HOLES },
        name, startsAt: "", countsTowardTrip: counts, scoringMode: mode, scorerPlayerId: mode === "INDIVIDUAL" ? null : scorer, playerIds: selected, games,
      });
    });
    if (err) return setError(err);
    nav({ name: "round", roundId: id, tab: "score" });
  }

  const seg = (opts: { v: string; l: string }[], value: string, onChange: (v: string) => void) => (
    <div className="seg">{opts.map((o) => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.l}</button>)}</div>
  );
  const sidePicker = (sides: Record<string, Side>, onChange: (s: Record<string, Side>) => void, labels = ["Side A", "Side B"]) => (
    <div className="flex flex-col gap-1">
      {players.filter((p) => selected.includes(p.id)).map((p) => (
        <div key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm"><span>{p.name}</span>
          <div className="seg w-40"><button type="button" aria-pressed={(sides[p.id] ?? "A") === "A"} onClick={() => onChange({ ...sides, [p.id]: "A" })}>{labels[0]}</button><button type="button" aria-pressed={sides[p.id] === "B"} onClick={() => onChange({ ...sides, [p.id]: "B" })}>{labels[1]}</button></div>
        </div>
      ))}
    </div>
  );
  const gameBox = (label: string, on: boolean, onToggle: () => void, body: React.ReactNode) => (
    <div className={`rounded-xl border p-3 ${on ? "border-accent" : "border-line"}`}>
      <label className="flex items-center justify-between tap"><span className="font-medium">{label}</span><input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={on} onChange={onToggle} /></label>
      {on && <div className="mt-2 flex flex-col gap-2">{body}</div>}
    </div>
  );
  const moneyField = (label: string, value: string, onChange: (v: string) => void) => (
    <label><span className="label">{label}</span><input className="field" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} /></label>
  );
  const basis = (value: "GROSS" | "NET", onChange: (v: "GROSS" | "NET") => void) => seg([{ v: "NET", l: "Net" }, { v: "GROSS", l: "Gross" }], value, (v) => onChange(v as "GROSS" | "NET"));

  return (
    <>
      <AppHeader title="Add round" subtitle={trip.name} showBack />
      <Page>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <section className="card p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Course & tees</h2>
            <label><span className="label">Course / tee</span>
              <select className="field" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                {state.courses.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.teeName} · par {c.par} · {c.courseRating}/{c.slopeRating}</option>)}
                <option value="manual">Enter a course manually…</option>
              </select>
            </label>
            {!course && (
              <>
                <label><span className="label">Course name</span><input className="field" placeholder="Pinehurst No. 2" value={courseName} onChange={(e) => setCourseName(e.target.value)} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label><span className="label">Rating</span><input className="field" inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} /></label>
                  <label><span className="label">Slope</span><input className="field" inputMode="numeric" value={slope} onChange={(e) => setSlope(e.target.value)} /></label>
                </div>
                <p className="text-xs text-muted">The prototype uses a standard par-72 hole layout for manual courses; the full app takes all 18 holes.</p>
              </>
            )}
            <label><span className="label">Round name</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
          </section>

          <section className="card p-4 flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Players</h2>
            <p className="text-xs text-muted -mt-1">Handicap Index is snapshotted now; Course Handicap comes from the tee&apos;s rating and slope.</p>
            {players.map((p) => {
              const on = selected.includes(p.id);
              const ch = chFor(p.handicapIndex);
              return (
                <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(p.id)} className={`tap flex items-center justify-between rounded-xl border px-3 text-left ${on ? "border-accent bg-tint/60" : "border-line"}`}>
                  <span className="font-medium">{p.name}</span><span className="text-xs text-ink-2">HI {p.handicapIndex.toFixed(1)}{on && ch !== null ? ` → CH ${ch}` : ""}</span>
                </button>
              );
            })}
          </section>

          <section className="card p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Format</h2>
            <label className="flex items-center justify-between tap"><span className="font-medium">Counts toward trip standings</span><input type="checkbox" className="h-6 w-6 accent-[var(--accent)]" checked={counts} onChange={(e) => setCounts(e.target.checked)} /></label>
            <div>
              <span className="label">Scoring mode</span>
              {seg([{ v: "HYBRID", l: "Hybrid" }, { v: "GROUP_SCORER", l: "Group scorer" }, { v: "INDIVIDUAL", l: "Individual" }], mode, (v) => setMode(v as typeof mode))}
              <p className="text-xs text-muted mt-1">{mode === "HYBRID" ? "Everyone enters their own; the scorer and organizers can enter for anyone." : mode === "GROUP_SCORER" ? "One scorer enters all scores." : "Each player enters only their own score."}</p>
            </div>
            {mode !== "INDIVIDUAL" && (
              <label><span className="label">Scorer</span>
                <select className="field" value={scorer} onChange={(e) => setScorer(e.target.value)}>{players.filter((p) => selected.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
            )}
          </section>

          <section className="card p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-2">Games</h2>
            {gameBox("Stroke play", g.stroke.on, () => setG((x) => ({ ...x, stroke: { ...x.stroke, on: !x.stroke.on } })), <>{basis(g.stroke.basis, (b) => setG((x) => ({ ...x, stroke: { ...x.stroke, basis: b } })))}{moneyField("Stake per player ($, 0 = none)", g.stroke.stake, (v) => setG((x) => ({ ...x, stroke: { ...x.stroke, stake: v } })))}</>)}
            {gameBox("Skins", g.skins.on, () => setG((x) => ({ ...x, skins: { ...x.skins, on: !x.skins.on } })), <>{basis(g.skins.basis, (b) => setG((x) => ({ ...x, skins: { ...x.skins, basis: b } })))}{moneyField("Skin value ($, from each other player)", g.skins.value, (v) => setG((x) => ({ ...x, skins: { ...x.skins, value: v } })))}<label className="flex items-center justify-between tap text-sm"><span>Carryovers</span><input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={g.skins.carryover} onChange={(e) => setG((x) => ({ ...x, skins: { ...x.skins, carryover: e.target.checked } }))} /></label></>)}
            {gameBox("Nassau", g.nassau.on, () => setG((x) => ({ ...x, nassau: { ...x.nassau, on: !x.nassau.on } })), <>{basis(g.nassau.basis, (b) => setG((x) => ({ ...x, nassau: { ...x.nassau, basis: b } })))}{moneyField("Amount per segment ($)", g.nassau.amount, (v) => setG((x) => ({ ...x, nassau: { ...x.nassau, amount: v } })))}{sidePicker(g.nassau.sides, (s) => setG((x) => ({ ...x, nassau: { ...x.nassau, sides: s } })))}</>)}
            {gameBox("Match play", g.match.on, () => setG((x) => ({ ...x, match: { ...x.match, on: !x.match.on } })), <>{basis(g.match.basis, (b) => setG((x) => ({ ...x, match: { ...x.match, basis: b } })))}{moneyField("Amount ($)", g.match.amount, (v) => setG((x) => ({ ...x, match: { ...x.match, amount: v } })))}{sidePicker(g.match.sides, (s) => setG((x) => ({ ...x, match: { ...x.match, sides: s } })))}</>)}
            {gameBox("Stableford", g.stableford.on, () => setG((x) => ({ ...x, stableford: { ...x.stableford, on: !x.stableford.on } })), <>{basis(g.stableford.basis, (b) => setG((x) => ({ ...x, stableford: { ...x.stableford, basis: b } })))}{moneyField("Stake per player ($)", g.stableford.stake, (v) => setG((x) => ({ ...x, stableford: { ...x.stableford, stake: v } })))}</>)}
            {gameBox("Best ball (teams)", g.bestBall.on, () => setG((x) => ({ ...x, bestBall: { ...x.bestBall, on: !x.bestBall.on } })), <>{basis(g.bestBall.basis, (b) => setG((x) => ({ ...x, bestBall: { ...x.bestBall, basis: b } })))}{moneyField("Stake per player ($)", g.bestBall.stake, (v) => setG((x) => ({ ...x, bestBall: { ...x.bestBall, stake: v } })))}{sidePicker(g.bestBall.sides, (s) => setG((x) => ({ ...x, bestBall: { ...x.bestBall, sides: s } })), ["Team A", "Team B"])}</>)}
          </section>
          {error && <p className="text-sm text-neg">{error}</p>}
          <Button type="submit" disabled={selected.length === 0}>Start round</Button>
        </form>
      </Page>
    </>
  );
}

/* ================= Money ================= */
export function MoneyScreen({ tripId }: { tripId: string }) {
  const { state } = useApp();
  const d = tripDashboard(state, tripId);
  const name = (id: string) => nameOf(state, id);
  const active = d.ledger.filter((e) => e.status !== "REVERSED");
  const reversed = d.ledger.filter((e) => e.status === "REVERSED");
  return (
    <>
      <AppHeader title="Money" subtitle={d.trip.name} showBack />
      <Page>
        <Card title="Net position">
          <ul className="divide-y divide-line">
            {d.standings.map((s) => (
              <li key={s.playerId} className="flex items-center justify-between py-2"><span className="font-medium">{s.displayName}</span><span className={`font-semibold ${s.moneyCents > 0 ? "text-ink" : s.moneyCents < 0 ? "text-neg" : "text-muted"}`}>{money(s.moneyCents, { sign: true })}</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Settle up" action={<span className="text-xs text-muted">{d.settlement.payments.length} payment{d.settlement.payments.length === 1 ? "" : "s"}</span>}>
          {d.settlement.payments.length === 0 ? <p className="text-sm text-muted">Everyone is even.</p> : (
            <ul className="divide-y divide-line">
              {d.settlement.payments.map((p, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm"><span><span className="font-medium">{name(p.fromPlayerId)}</span> pays <span className="font-medium">{name(p.toPlayerId)}</span></span><span className="font-semibold">{money(p.amountCents)}</span></li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted mt-2">Fewest payments that clear every balance. Itemized obligations below stay on record.</p>
        </Card>
        <Card title="Itemized ledger" action={<span className="text-xs text-muted">{active.length} entries</span>}>
          {active.length === 0 ? <p className="text-sm text-muted">Nothing posted yet. Lock a round or settle a side bet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {active.map((e) => (
                <li key={e.id} className="py-2">
                  <div className="flex items-center justify-between"><span>{name(e.fromPlayerId)} → {name(e.toPlayerId)}</span><span className="font-semibold">{money(e.amountCents)}</span></div>
                  <p className="text-xs text-muted">{e.sourceType === "SIDE_BET" ? "Side bet" : e.sourceType === "GAME" ? "Game" : e.sourceType} · {e.memo}</p>
                </li>
              ))}
            </ul>
          )}
          {reversed.length > 0 && (
            <details className="mt-2"><summary className="text-xs font-semibold text-muted cursor-pointer">{reversed.length} reversed / corrected entries</summary>
              <ul className="text-xs text-muted mt-1 space-y-1">{reversed.map((e) => <li key={e.id} className="line-through">{name(e.fromPlayerId)} → {name(e.toPlayerId)} {money(e.amountCents)} · {e.memo}</li>)}</ul>
            </details>
          )}
        </Card>
      </Page>
    </>
  );
}

/* ================= Round ================= */
export function RoundScreen({ route }: { route: Extract<Route, { name: "round" }> }) {
  const { state } = useApp();
  const snap = roundSnapshot(state, route.roundId);
  return (
    <>
      <AppHeader title={snap.round.name} subtitle={`${snap.course.name} · ${snap.course.teeName} · ${snap.course.courseRating}/${snap.course.slopeRating}`} showBack />
      {route.tab === "overview" && <OverviewTab snap={snap} />}
      {route.tab === "score" && <ScoreTab key={`score-${route.hole ?? "auto"}`} snap={snap} hole={route.hole} focusPlayer={route.player} />}
      {route.tab === "scorecard" && <ScorecardTab snap={snap} />}
      {route.tab === "games" && <GamesTab snap={snap} />}
      {route.tab === "stats" && <StatsTab snap={snap} />}
      {route.tab === "finish" && <FinishTab snap={snap} />}
      <RoundTabs roundId={snap.round.id} tab={route.tab} />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2/60 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="font-display text-2xl leading-tight">{value}</p>
      {sub && <p className="text-xs font-semibold">{sub}</p>}
    </div>
  );
}

function OverviewTab({ snap }: { snap: Snapshot }) {
  const { state, nav, mutate } = useApp();
  const roundId = snap.round.id;
  const me = snap.players.find((p) => p.playerId === state.actorId);
  const myTotals = me ? snap.totals[me.playerId] : null;
  const myStats = me ? snap.stats[me.playerId] : null;
  const live = snap.round.status === "LIVE";
  const hole = snap.currentHole ? snap.holes.find((h) => h.holeNumber === snap.currentHole)! : null;
  const canOrganize = !!me && me.tripRole === "OWNER";
  const roundLedger = state.ledger.filter((e) => e.roundId === roundId && e.status !== "REVERSED");
  const highlights = snap.players.flatMap((p) => snap.totals[p.playerId].holes.filter((h) => h.grossToPar !== null && h.grossToPar <= -1).map((h) => ({ player: p.displayName, hole: h.holeNumber, label: h.grossToPar === -1 ? "Birdie" : h.grossToPar === -2 ? "Eagle" : "Albatross" })));
  return (
    <Page>
      {live && hole ? (
        <Card className="!bg-ink !border-ink !border-t-brass text-[var(--bg)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide opacity-80">Now playing</p>
              <h2 className="font-display text-2xl mt-0.5">Hole {hole.holeNumber}</h2>
              <p className="text-sm opacity-90">Par {hole.par}{hole.yardage ? ` · ${hole.yardage} yds` : ""} · SI {hole.strokeIndex}</p>
            </div>
            <button type="button" onClick={() => nav({ name: "round", roundId, tab: "score", hole: hole.holeNumber })} className="btn btn-secondary !text-ink">Score</button>
          </div>
          {snap.nowNotes.length > 0 && <ul className="mt-3 text-sm space-y-1 border-t border-white/20 pt-2">{snap.nowNotes.map((n, i) => <li key={i} className="flex gap-2"><span aria-hidden>•</span>{n}</li>)}</ul>}
        </Card>
      ) : live ? (
        <Card className="!bg-ink !border-ink !border-t-brass text-[var(--bg)]">
          <p className="font-display text-xl">All 18 holes scored</p>
          <p className="text-sm opacity-90 mt-1">Review the card, resolve any bets, then finish the round to lock it and post results.</p>
          <button type="button" onClick={() => nav({ name: "round", roundId, tab: "finish" })} className="btn btn-secondary w-full mt-3 !text-ink">Finish round</button>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between">
            <div><p className="font-display text-xl">Round locked</p><p className="text-xs text-muted">Results are posted{snap.round.countsTowardTrip ? " and count toward the trip" : "; standalone round"}.</p></div>
            <Pill tone="green">Final</Pill>
          </div>
          {canOrganize && (
            <div className="mt-3">
              <Button variant="secondary" className="w-full text-sm" onClick={() => mutate((s) => reopenRound(s, roundId))}>Reopen for correction</Button>
              <p className="text-[11px] text-muted mt-1">Reverses this round&apos;s posted game results with an audit trail; finishing again re-posts them.</p>
            </div>
          )}
        </Card>
      )}

      {me && myTotals && (
        <Card title={`${me.displayName} · CH ${me.courseHandicap}`} action={<TextLink className="!text-xs" onClick={() => nav({ name: "round", roundId, tab: "stats" })}>Stats ›</TextLink>}>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Gross" value={myTotals.holesPlayed ? String(myTotals.total.gross) : "–"} sub={myTotals.holesPlayed ? <ToPar value={myTotals.total.grossToPar} /> : null} />
            <Stat label="Net" value={myTotals.holesPlayed ? String(myTotals.total.net) : "–"} sub={myTotals.holesPlayed ? <ToPar value={myTotals.total.netToPar} /> : null} />
            <Stat label="Thru" value={myTotals.holesPlayed ? String(myTotals.holesPlayed) : "–"} />
            <Stat label="Putts" value={myStats?.putts === null || myStats?.putts === undefined ? "–" : String(myStats.putts)} />
          </div>
        </Card>
      )}

      <Card title="Leaderboard" action={<TextLink className="!text-xs" onClick={() => nav({ name: "round", roundId, tab: "scorecard" })}>Scorecard ›</TextLink>}>
        <Leaderboard rows={snap.leaderboardNet} basis="NET" highlightId={state.actorId} />
      </Card>

      <Card title="Games" action={<TextLink className="!text-xs" onClick={() => nav({ name: "round", roundId, tab: "games" })}>All ›</TextLink>}>
        {snap.games.length === 0 ? <p className="text-sm text-muted">No games configured.</p> : (
          <ul className="divide-y divide-line">{snap.games.map((g) => <li key={g.id} className="py-2"><p className="text-xs uppercase tracking-wide text-muted">{g.name}</p><p className="font-medium text-sm">{g.summary.headline}</p></li>)}</ul>
        )}
        {snap.sideBets.length > 0 && <p className="text-xs text-ink-2 mt-2">{snap.sideBets.filter((b) => b.status === "PROPOSED").length} pending · {snap.sideBets.filter((b) => b.status === "ACCEPTED").length} open · {snap.sideBets.filter((b) => b.status === "SETTLED").length} settled side bets</p>}
      </Card>

      <CourseMapCard snap={snap} />
      <Card title="Money position" action={<TextLink className="!text-xs" onClick={() => nav({ name: "money", tripId: snap.round.tripId })}>Trip ledger ›</TextLink>}>
        {roundLedger.length === 0 && <p className="text-sm text-muted">{live ? "Projected from live games; nothing is posted until the round is locked." : "No money posted for this round."}</p>}
        <ul className="grid grid-cols-2 gap-2 text-sm mt-1">
          {snap.players.map((p) => {
            const v = live
              ? snap.games.flatMap((g) => g.settlements).reduce((a, st) => a + (st.toPlayerId === p.playerId ? st.amountCents : 0) - (st.fromPlayerId === p.playerId ? st.amountCents : 0), 0)
              : roundLedger.reduce((a, e) => a + (e.toPlayerId === p.playerId ? e.amountCents : 0) - (e.fromPlayerId === p.playerId ? e.amountCents : 0), 0);
            return <li key={p.playerId} className="flex items-center justify-between rounded-lg bg-surface-2/60 px-3 py-2"><span className="font-medium">{p.displayName}</span><span className={`font-semibold ${v > 0 ? "text-ink" : v < 0 ? "text-neg" : "text-muted"}`}>{money(v, { sign: true })}</span></li>;
          })}
        </ul>
      </Card>

      {highlights.length > 0 && (
        <Card title="Highlights"><ul className="flex flex-wrap gap-2">{highlights.map((h, i) => <li key={i}><Pill tone={h.label === "Birdie" ? "green" : "gold"}>{h.player} · {h.label} on {h.hole}</Pill></li>)}</ul></Card>
      )}
      {live && <Button variant="secondary" onClick={() => nav({ name: "round", roundId, tab: "finish" })}>Finish round</Button>}
      {me?.tripRole === "OWNER" && (
        <button type="button" className="text-xs font-semibold text-neg self-center py-2" data-testid="delete-round" onClick={() => {
          if (!window.confirm(`Delete ${snap.round.name}? Scores, shots and games in it go too.${live ? "" : " Money it posted is reversed on the ledger."}`)) return;
          const tripId = snap.round.tripId;
          const err = mutate((s) => deleteRound(s, roundId));
          if (!err) nav({ name: "trip", tripId });
        }}>Delete this round</button>
      )}
    </Page>
  );
}

/* ---------- score tab ---------- */
function ScoreTab({ snap, hole: requested, focusPlayer }: { snap: Snapshot; hole?: number; focusPlayer?: string }) {
  const { state, nav, mutate } = useApp();
  const roundId = snap.round.id;
  // Pin the hole for the life of this screen so finishing the last player's score never jumps ahead.
  const [holeNumber] = useState(() => (requested && snap.holes.some((h) => h.holeNumber === requested) ? requested : (snap.currentHole ?? snap.holes[snap.holes.length - 1].holeNumber)));
  const hole = snap.holes.find((h) => h.holeNumber === holeNumber)!;
  const idx = snap.holes.findIndex((h) => h.holeNumber === holeNumber);
  const prev = idx > 0 ? snap.holes[idx - 1].holeNumber : null;
  const next = idx < snap.holes.length - 1 ? snap.holes[idx + 1].holeNumber : null;
  const go = (h: number) => nav({ name: "round", roundId, tab: "score", hole: h });
  const actorRole = tripRole(state, snap.round.tripId, state.actorId);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [aimMode, setAimMode] = useState(false);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const me = snap.players.find((p) => p.playerId === state.actorId);
  const canTrack = !!me && snap.round.status === "LIVE" && canEditScore({ actorId: state.actorId, actorRole, scoringMode: snap.round.scoringMode, scorerPlayerId: snap.round.scorerPlayerId, targetPlayerId: state.actorId, roundStatus: snap.round.status });
  const myShots = me ? holeShots(snap.round, me.playerId, holeNumber) : [];
  // Whose trails to overlay: just me by default; group, everyone, or a hand-picked set.
  const filter = state.shotFilter ?? { mode: "me" as const, playerIds: [] };
  const palette = snap.players.map((p, i) => ({ playerId: p.playerId, name: p.displayName, color: TRAIL_COLORS[i % TRAIL_COLORS.length] }));
  const hasGroups = (snap.round.groups?.length ?? 0) > 1;
  const shownIds = !me ? [] : filter.mode === "all" ? snap.players.map((p) => p.playerId) : filter.mode === "group" ? groupMates(snap.round, me.playerId) : filter.mode === "custom" ? filter.playerIds : [];
  const others = palette.filter((p) => p.playerId !== me?.playerId && shownIds.includes(p.playerId)).map((p) => ({ ...p, shots: holeShots(snap.round, p.playerId, holeNumber) })).filter((p) => p.shots.length > 0);
  // Every change to this hole's shots is reversible: snapshots before each edit, one entry per drag.
  const [undoStack, setUndoStack] = useState<Shot[][]>([]);
  const [redoStack, setRedoStack] = useState<Shot[][]>([]);
  const cloneShots = (list: Shot[]) => list.map((sh) => ({ ...sh, from: { ...sh.from }, to: { ...sh.to }, aim: sh.aim ? { ...sh.aim } : sh.aim }));
  const withUndo = (fn: (s: State) => void) => { const before = cloneShots(myShots); setUndoStack((u) => [...u.slice(-24), before]); setRedoStack([]); return mutate(fn); };
  const restore = (shots: Shot[]) => mutate((s) => replaceHoleShots(s, roundId, me!.playerId, holeNumber, shots));
  const doUndo = () => { const before = undoStack[undoStack.length - 1]; if (!before) return; setRedoStack((r) => [...r, cloneShots(myShots)]); setUndoStack((u) => u.slice(0, -1)); restore(before); };
  const doRedo = () => { const after = redoStack[redoStack.length - 1]; if (!after) return; setUndoStack((u) => [...u, cloneShots(myShots)]); setRedoStack((r) => r.slice(0, -1)); restore(after); };
  const holeDone = snap.players.every((p) => findScore(snap.round, p.playerId, holeNumber).entry.grossScore !== null);
  const leaderLine = snap.leaderboardNet.filter((r) => r.holesPlayed > 0).slice(0, 3);
  const anyEditable = snap.players.some((p) => canEditScore({ actorId: state.actorId, actorRole, scoringMode: snap.round.scoringMode, scorerPlayerId: snap.round.scorerPlayerId, targetPlayerId: p.playerId, roundStatus: snap.round.status }));

  return (
    <Page className="!pt-3">
      <MiniScorecard snap={snap} current={holeNumber} view={state.scorecardView ?? "gross"} onView={(v) => mutate((s) => setScorecardView(s, v))} onHole={go} />
      <header className="flex items-center justify-between -mb-1">
        <NavBtn onClick={prev !== null ? () => go(prev) : null} label="Previous hole">‹</NavBtn>
        <p className="text-xs text-ink-2">Hole {hole.holeNumber} of {snap.holes.length}</p>
        <NavBtn onClick={next !== null ? () => go(next) : null} label="Next hole">›</NavBtn>
      </header>
      <HoleView
        holeNumber={hole.holeNumber}
        par={hole.par}
        yardage={hole.yardage}
        strokeIndex={hole.strokeIndex}
        numbers={state.players.find((p) => p.id === state.actorId)?.favoriteYardages ?? [140]}
        onNumbersChange={(n) => mutate((s) => { const me = s.players.find((p) => p.id === s.actorId); if (me) me.favoriteYardages = n; })}
        wind={state.wind ?? { mph: 12, fromDeg: 225 }}
        onWindChange={(w) => mutate((s) => { s.wind = w; })}
        tracking={tracking && canTrack}
        shots={myShots}
        onShot={(to) => withUndo((s) => { logShot(s, roundId, s.actorId, holeNumber, to); })}
        onMoveShot={(id, to, first) => (first ? withUndo : mutate)((s) => moveShotRest(s, roundId, id, to))}
        focusShot={tracking ? myShots.find((s) => s.id === selectedShotId) ?? null : null}
        others={others}
        aim={me ? pendingAim(state, roundId, me.playerId, holeNumber) : null}
        aimMode={aimMode && tracking && canTrack}
        onSetAim={(p) => { mutate((s) => setPendingAim(s, roundId, s.actorId, holeNumber, p)); setAimMode(false); }}
        onAimButton={() => { if (!canTrack) return; if (!tracking) setTracking(true); setAimMode((a) => !a); }}
        shape={holeShapeFor(state, snap.round.courseId, holeNumber)}
      />
      {me && (
        <div className="card !py-2 flex flex-col gap-1.5">
          <ShotFilterControl mode={filter.mode} playerIds={filter.playerIds} players={palette} me={me.playerId} hasGroups={hasGroups} onChange={(mode, ids) => mutate((s) => setShotFilter(s, { mode, playerIds: ids }))} />
          {filter.mode !== "me" && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" data-testid="trail-legend">
              {others.length === 0 && <span className="text-muted">Nobody else has tracked this hole yet.</span>}
              {others.map((o) => <span key={o.playerId} className="inline-flex items-center gap-1 text-ink-2"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />{o.name} · {o.shots.length} shot{o.shots.length === 1 ? "" : "s"}</span>)}
            </div>
          )}
        </div>
      )}
      {canTrack && (
        <ShotLog
          shots={myShots}
          tracking={tracking}
          onToggle={() => { setTracking((t) => !t); setAimMode(false); }}
          selectedId={selectedShotId}
          onSelect={setSelectedShotId}
          aim={pendingAim(state, roundId, me!.playerId, holeNumber)}
          aimMode={aimMode}
          onAimMode={() => setAimMode((a) => !a)}
          onClearAim={() => { mutate((s) => setPendingAim(s, roundId, s.actorId, holeNumber, null)); setAimMode(false); }}
          playerName={me!.displayName}
          par={hole.par}
          penalties={findScore(snap.round, me!.playerId, holeNumber).entry.penaltyStrokes}
          putts={findScore(snap.round, me!.playerId, holeNumber).entry.putts}
          gross={findScore(snap.round, me!.playerId, holeNumber).entry.grossScore}
          remaining={dist(myShots.length ? myShots[myShots.length - 1].to : { u: 0, v: 0 }, holeShapeFor(state, snap.round.courseId, holeNumber).green.c)}
          flag={holeShapeFor(state, snap.round.courseId, holeNumber).green.c}
          suggested={clubForRemaining(snap.round, me!.playerId, dist(myShots.length ? myShots[myShots.length - 1].to : { u: 0, v: 0 }, pendingAim(state, roundId, me!.playerId, holeNumber) ?? holeShapeFor(state, snap.round.courseId, holeNumber).green.c))}
          onMark={(club) => withUndo((s) => { markBall(s, roundId, s.actorId, holeNumber, club); })}
          onPutt={(leaveFt) => withUndo((s) => { logPutt(s, roundId, s.actorId, holeNumber, leaveFt); })}
          onUpdate={(id, patch) => withUndo((s) => updateShot(s, roundId, id, patch))}
          onUndo={doUndo}
          onRedo={doRedo}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onHoleOut={(putts) => { const err = mutate((s) => { const r = holeOut(s, roundId, s.actorId, holeNumber, putts); if (r.status !== "saved") throw new Error(r.status === "forbidden" ? r.reason : "Conflict"); }); if (err) setError(err); }}
          onAddDistance={(yds) => withUndo((s) => { addShotByDistance(s, roundId, s.actorId, holeNumber, yds, holeShapeFor(state, snap.round.courseId, holeNumber).green.c); })}
          onSetDistance={(id, yds) => withUndo((s) => setShotDistance(s, roundId, id, yds, holeShapeFor(state, snap.round.courseId, holeNumber).green.c))}
          onDelete={(id) => withUndo((s) => deleteShot(s, roundId, id))}
        />
      )}
      {snap.round.status !== "LIVE" && <p className="text-sm text-muted text-center">This round is locked. Scores are read-only.</p>}
      {snap.round.status === "LIVE" && !anyEditable && <p className="text-sm text-brass text-center">You can&apos;t enter scores for this group in {snap.round.scoringMode.toLowerCase().replace("_", " ")} mode. Switch player at the top to try.</p>}
      {error && <p className="text-sm text-neg text-center">{error}</p>}
      {snap.players.map((p) => {
        const row = findScore(snap.round, p.playerId, holeNumber);
        const editable = canEditScore({ actorId: state.actorId, actorRole, scoringMode: snap.round.scoringMode, scorerPlayerId: snap.round.scorerPlayerId, targetPlayerId: p.playerId, roundStatus: snap.round.status });
        return (
          <PlayerRow
            key={p.playerId}
            name={p.displayName}
            strokes={p.allocation[holeNumber] ?? 0}
            par={hole.par}
            entry={row.entry}
            synced={row.version > 0}
            editable={editable}
            focus={focusPlayer === p.playerId}
            onChange={(patch) => {
              setError(null);
              const err = mutate((s) => {
                const r = saveScore(s, roundId, p.playerId, holeNumber, patch, findScore(s.rounds.find((x) => x.id === roundId)!, p.playerId, holeNumber).version);
                if (r.status !== "saved") throw new Error(r.status === "forbidden" ? r.reason : "Conflict");
              });
              if (err) setError(err);
            }}
          />
        );
      })}
      {snap.round.status === "LIVE" && <NewSideBetForm snap={snap} defaultHole={holeNumber} />}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => nav({ name: "round", roundId, tab: "scorecard" })}>Scorecard</Button>
        {next !== null ? <Button variant={holeDone ? "primary" : "secondary"} onClick={() => go(next)}>Next hole ›</Button> : <Button onClick={() => nav({ name: "round", roundId, tab: "finish" })}>Finish round</Button>}
      </div>
      {leaderLine.length > 0 && <p className="text-xs text-muted text-center">Net: {leaderLine.map((r) => `${r.displayName} ${r.netToPar === 0 ? "E" : r.netToPar > 0 ? `+${r.netToPar}` : r.netToPar}`).join(" · ")}</p>}
    </Page>
  );
}

function NavBtn({ onClick, label, children }: { onClick: (() => void) | null; label: string; children: React.ReactNode }) {
  if (!onClick) return <span className="tap inline-flex items-center justify-center text-line-strong text-2xl" aria-hidden>{children}</span>;
  return <button type="button" onClick={onClick} aria-label={label} className="tap inline-flex items-center justify-center rounded-xl bg-surface-2 text-2xl font-semibold text-ink">{children}</button>;
}

function PlayerRow({ name, strokes, par, entry: e, synced, editable, focus, onChange }: { name: string; strokes: number; par: number; entry: HoleEntry; synced: boolean; editable: boolean; focus: boolean; onChange: (patch: Partial<HoleEntry>) => void }) {
  const [more, setMore] = useState(false);
  const [celebrate, setCelebrate] = useState<"birdie" | "eagle" | null>(null);
  const disabled = !editable;
  const gross = e.grossScore;
  const toPar = gross === null ? null : gross - par;
  const net = gross === null ? null : gross - strokes;
  const setGross = (n: number | null) => {
    const v = n === null ? null : Math.max(1, Math.min(20, n));
    if (v !== null) { const tp = v - par; setCelebrate(tp <= -2 ? "eagle" : tp === -1 ? "birdie" : null); }
    onChange({ grossScore: v });
  };
  return (
    <section ref={(el) => { if (focus && el) el.scrollIntoView({ block: "center" }); }} className={`card p-3 ${disabled ? "opacity-80" : ""}`} aria-label={`${name} hole entry`}>
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0"><span className="font-semibold truncate">{name}</span><StrokeDots n={strokes} />{strokes !== 0 && <span className="text-[11px] text-muted">{strokes > 0 ? `gets ${strokes}` : `gives ${-strokes}`}</span>}</div>
        <span className={`text-[11px] font-semibold ${editable ? "text-brass" : "text-muted"}`}>{!editable ? "view only" : synced ? "Synced" : ""}</span>
      </header>
      <div className="flex items-center gap-2">
        <button type="button" className="tap btn btn-secondary !min-h-14 !w-14 !px-0 text-2xl" aria-label="Minus one stroke" disabled={disabled || gross === 1} onClick={() => setGross(gross === null ? par - 1 : gross - 1)}>−</button>
        <button type="button" className="tap flex-1 h-14 rounded-xl border border-line bg-surface-2/60 flex flex-col items-center justify-center leading-none" disabled={disabled} onClick={() => gross === null && setGross(par)} aria-label={gross === null ? `Set score to par ${par}` : `Score ${gross}`}>
          <span className={`font-display text-3xl ${gross === null ? "text-muted" : ""} ${celebrate === "birdie" ? "celebrate-birdie px-2" : celebrate === "eagle" ? "celebrate-eagle px-2" : ""}`}>{gross ?? par}</span>
          <span className="text-[11px] text-muted mt-1">{gross === null ? "tap for par" : toPar === 0 ? "par" : toPar === -1 ? "birdie" : toPar === -2 ? "eagle" : (toPar ?? 0) < -2 ? "albatross" : toPar === 1 ? "bogey" : toPar === 2 ? "double" : `+${toPar}`}{net !== null && strokes !== 0 ? ` · net ${net}` : ""}</span>
        </button>
        <button type="button" className="tap btn btn-primary !min-h-14 !w-14 !px-0 text-2xl" aria-label="Plus one stroke" disabled={disabled} onClick={() => setGross(gross === null ? par : gross + 1)}>+</button>
      </div>
      <div className={`mt-3 grid gap-2 ${par >= 4 ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1"}`}>
        {par >= 4 && (
          <div><span className="label">Fairway</span>
            <div className="seg" role="group" aria-label="Fairway">{(["LEFT", "HIT", "RIGHT"] as const).map((v) => <button key={v} type="button" disabled={disabled} aria-pressed={e.fairwayResult === v} onClick={() => onChange({ fairwayResult: e.fairwayResult === v ? null : v })}>{v === "HIT" ? "Hit" : v === "LEFT" ? "◀ L" : "R ▶"}</button>)}</div>
          </div>
        )}
        <div><span className="label">Green</span>
          <div className="seg" role="group" aria-label="Green in regulation"><button type="button" disabled={disabled} aria-pressed={e.gir === true} onClick={() => onChange({ gir: e.gir === true ? null : true })}>GIR ⛳</button><button type="button" disabled={disabled} aria-pressed={e.gir === false} onClick={() => onChange({ gir: e.gir === false ? null : false })}>Miss</button></div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1.4fr_1fr] gap-2">
        <div><span className="label">Putts</span>
          <div className="seg" role="group" aria-label="Putts">{[0, 1, 2, 3].map((n) => <button key={n} type="button" disabled={disabled} aria-pressed={e.putts === n || (n === 3 && (e.putts ?? 0) > 3)} onClick={() => onChange({ putts: e.putts === n ? null : n === 3 && (e.putts ?? 0) >= 3 ? (e.putts ?? 3) + 1 : n })}>{n === 3 ? ((e.putts ?? 0) > 3 ? `${e.putts}` : "3+") : n}</button>)}</div>
        </div>
        <div><span className="label">Penalty</span>
          <div className="seg" role="group" aria-label="Penalty strokes"><button type="button" disabled={disabled || e.penaltyStrokes === 0} onClick={() => onChange({ penaltyStrokes: Math.max(0, e.penaltyStrokes - 1) })}>−</button><button type="button" disabled aria-pressed={e.penaltyStrokes > 0} className="!opacity-100">{e.penaltyStrokes}</button><button type="button" disabled={disabled} onClick={() => onChange({ penaltyStrokes: e.penaltyStrokes + 1 })}>+</button></div>
        </div>
      </div>
      <button type="button" className="mt-2 text-xs font-semibold text-accent tap !min-h-9" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? "Less" : "More stats"}</button>
      {more && (
        <div className="grid grid-cols-2 gap-2 mt-1">
          <div><span className="label">OB strokes</span><div className="seg"><button type="button" disabled={disabled || e.obStrokes === 0} onClick={() => onChange({ obStrokes: e.obStrokes - 1 })}>−</button><button type="button" disabled className="!opacity-100" aria-pressed={e.obStrokes > 0}>{e.obStrokes}</button><button type="button" disabled={disabled} onClick={() => onChange({ obStrokes: e.obStrokes + 1 })}>+</button></div></div>
          <label><span className="label">Drive (yds)</span><input type="number" inputMode="numeric" className="field" disabled={disabled} value={e.driveDistance ?? ""} onChange={(ev) => onChange({ driveDistance: ev.target.value === "" ? null : Number(ev.target.value) })} /></label>
          <TriState label="Sand save" attempt={e.sandAttempt} result={e.sandSave} disabled={disabled} onChange={(a, r) => onChange({ sandAttempt: a, sandSave: r })} />
          <TriState label="Up & down" attempt={e.upDownAttempt} result={e.upDown} disabled={disabled} onChange={(a, r) => onChange({ upDownAttempt: a, upDown: r })} />
        </div>
      )}
    </section>
  );
}

function TriState({ label, attempt, result, disabled, onChange }: { label: string; attempt: boolean | null; result: boolean | null; disabled: boolean; onChange: (a: boolean | null, r: boolean | null) => void }) {
  const state = attempt !== true ? "none" : result ? "yes" : "no";
  return (
    <div><span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}><button type="button" disabled={disabled} aria-pressed={state === "none"} onClick={() => onChange(null, null)}>n/a</button><button type="button" disabled={disabled} aria-pressed={state === "yes"} onClick={() => onChange(true, true)}>✓</button><button type="button" disabled={disabled} aria-pressed={state === "no"} onClick={() => onChange(true, false)}>✗</button></div>
    </div>
  );
}

/* ---------- scorecard / stats ---------- */
function ScorecardTab({ snap }: { snap: Snapshot }) {
  const { nav } = useApp();
  return (
    <Page>
      <div className="flex items-center justify-between"><h2 className="font-display text-xl">Scorecard</h2><TextLink onClick={() => nav({ name: "round", roundId: snap.round.id, tab: "score" })}>Hole entry ›</TextLink></div>
      <Scorecard snap={snap} onCell={snap.round.status === "LIVE" ? (playerId, hole) => nav({ name: "round", roundId: snap.round.id, tab: "score", hole, player: playerId }) : null} />
    </Page>
  );
}

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v)}%`);
const num = (v: number | null) => (v === null ? "–" : String(v));
function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-lg bg-surface-2/60 py-2 px-1"><p className="text-[10px] uppercase tracking-wide text-muted">{label}</p><p className="font-display text-xl leading-tight">{value}</p>{sub && <p className="text-[10px] text-ink-2">{sub}</p>}</div>;
}
function StatsTab({ snap }: { snap: Snapshot }) {
  const { state } = useApp();
  const ordered = [...snap.players].sort((a, b) => (a.playerId === state.actorId ? -1 : b.playerId === state.actorId ? 1 : 0));
  return (
    <Page>
      {ordered.map((p) => {
        const st = snap.stats[p.playerId]; const t = snap.totals[p.playerId];
        return (
          <Card key={p.playerId} title={`${p.displayName} · thru ${t.holesPlayed}`}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Tile label="Fairways" value={pct(st.fairwayPct)} sub={st.fairwayOpportunities ? `${st.fairwaysHit}/${st.fairwayOpportunities}` : "not tracked"} />
              <Tile label="GIR" value={pct(st.girPct)} sub={st.girOpportunities ? `${st.girs}/${st.girOpportunities}` : "not tracked"} />
              <Tile label="Putts" value={num(st.putts)} sub={st.puttsPerGir !== null ? `${st.puttsPerGir}/GIR` : ""} />
              <Tile label="Birdies+" value={String(st.birdiesOrBetter)} sub={`${st.pars} pars`} />
              <Tile label="Bogeys" value={String(st.bogeys)} sub={`${st.doublesOrWorse} double+`} />
              <Tile label="Penalties" value={String(st.penaltyStrokes)} sub={st.obStrokes ? `${st.obStrokes} OB` : ""} />
              <Tile label="Par 3 avg" value={num(st.par3Avg)} /><Tile label="Par 4 avg" value={num(st.par4Avg)} /><Tile label="Par 5 avg" value={num(st.par5Avg)} />
              <Tile label="Scrambling" value={pct(st.scramblingPct)} /><Tile label="Sand saves" value={pct(st.sandSavePct)} /><Tile label="Strokes rcvd" value={String(t.strokesReceived)} sub={`CH ${p.courseHandicap}`} />
            </div>
          </Card>
        );
      })}
      <BagCard shots={snap.round.shots ?? []} playerId={state.actorId} playerName={snap.players.find((p) => p.playerId === state.actorId)?.displayName ?? ""} />
      <p className="text-xs text-muted text-center">Percentages only count holes where that stat was entered. Nothing is inferred from the score.</p>
    </Page>
  );
}

/* ---------- games + side bets ---------- */
function GamesTab({ snap }: { snap: Snapshot }) {
  const { state, mutate } = useApp();
  const names = Object.fromEntries(snap.players.map((p) => [p.playerId, p.displayName]));
  const me = snap.players.find((p) => p.playerId === state.actorId);
  const canOrganize = !!me && me.tripRole === "OWNER";
  const live = snap.round.status === "LIVE";
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (s: Parameters<typeof mutate>[0] extends (s: infer S) => void ? S : never) => void) => { setError(null); const err = mutate(fn); if (err) setError(err); };
  return (
    <Page>
      {snap.games.length === 0 && <p className="text-sm text-muted">No games configured for this round.</p>}
      {snap.games.map((g) => <GameCard key={g.id} game={g} playerNames={names} />)}
      <Card title="Side bets" action={<span className="text-xs text-muted">Extra · separate from games</span>}>
        {error && <p className="text-sm text-neg mb-2">{error}</p>}
        {snap.sideBets.length === 0 ? <p className="text-sm text-muted">No side bets yet.</p> : (
          <ul className="flex flex-col gap-2">
            {snap.sideBets.map((b) => {
              const sideA = b.participants.filter((p) => p.side === "A"); const sideB = b.participants.filter((p) => p.side === "B");
              const mine = b.participants.find((p) => p.playerId === state.actorId);
              const canAccept = b.status === "PROPOSED" && mine && mine.playerId !== b.creatorId && !mine.acceptedAt;
              const canResolve = live && b.status === "ACCEPTED" && (canOrganize || !!mine);
              const tone = b.status === "SETTLED" ? "green" : b.status === "ACCEPTED" ? "gold" : b.status === "PROPOSED" ? "neutral" : "red";
              const n = (id: string) => names[id] ?? nameOf(state, id);
              return (
                <li key={b.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-semibold leading-tight">{b.terms.description}</p><p className="text-xs text-muted mt-0.5">{sideA.map((p) => n(p.playerId)).join(" & ")} vs {sideB.map((p) => n(p.playerId)).join(" & ")} · {money(b.terms.amountCents)}{b.terms.holeNumbers.length ? ` · hole${b.terms.holeNumbers.length > 1 ? "s" : ""} ${b.terms.holeNumbers.join(", ")}` : ""}</p></div>
                    <Pill tone={tone}>{b.status === "PROPOSED" ? "Awaiting" : b.status.charAt(0) + b.status.slice(1).toLowerCase()}</Pill>
                  </div>
                  {b.status === "PROPOSED" && <p className="text-xs text-ink-2 mt-1">Waiting on {b.participants.filter((p) => !p.acceptedAt).map((p) => n(p.playerId)).join(", ")}</p>}
                  {b.resolution && <p className="text-xs text-ink-2 mt-1">{b.resolution.winnerPlayerId ? `Winner: ${n(b.resolution.winnerPlayerId)}` : "Tied · void"}</p>}
                  {(canAccept || canResolve || (b.status === "PROPOSED" && mine)) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canAccept && <button className="btn btn-primary !min-h-10 text-sm" onClick={() => run((s) => acceptSideBet(s, snap.round.id, b.id, s.actorId))}>Accept</button>}
                      {b.status === "PROPOSED" && mine && <button className="btn btn-secondary !min-h-10 text-sm" onClick={() => run((s) => declineSideBet(s, snap.round.id, b.id, s.actorId))}>{mine.playerId === b.creatorId ? "Cancel" : "Decline"}</button>}
                      {canResolve && b.autoResult && <button className="btn btn-primary !min-h-10 text-sm" onClick={() => run((s) => resolveSideBet(s, snap.round.id, b.id, "AUTO", s.actorId))}>Resolve from scores ({b.autoResult === "TIE" ? "tie" : n(b.participants.find((p) => p.side === b.autoResult)!.playerId)})</button>}
                      {canResolve && (<>
                        <button className="btn btn-secondary !min-h-10 text-sm" onClick={() => run((s) => resolveSideBet(s, snap.round.id, b.id, "A", s.actorId))}>{sideA.map((p) => n(p.playerId)).join(" & ")} won</button>
                        <button className="btn btn-secondary !min-h-10 text-sm" onClick={() => run((s) => resolveSideBet(s, snap.round.id, b.id, "B", s.actorId))}>{sideB.map((p) => n(p.playerId)).join(" & ")} won</button>
                        <button className="btn btn-ghost !min-h-10 text-sm" onClick={() => run((s) => resolveSideBet(s, snap.round.id, b.id, "TIE", s.actorId))}>Tie / void</button>
                      </>)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {live && <NewSideBetForm snap={snap} defaultHole={snap.currentHole} />}
    </Page>
  );
}

function NewSideBetForm({ snap, defaultHole }: { snap: Snapshot; defaultHole: number | null }) {
  const { state, mutate } = useApp();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SideBetType>("LONGEST_DRIVE_IN_FAIRWAY");
  const [opponents, setOpponents] = useState<string[]>([]);
  const [amount, setAmount] = useState("20");
  const [holes, setHoles] = useState(defaultHole ? String(defaultHole) : "");
  const [basis, setBasis] = useState<"GROSS" | "NET">("GROSS");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preset = SIDE_BET_PRESETS.find((p) => p.type === type)!;
  if (!open) return <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>+ Side bet</Button>;
  const holeNumbers = holes.split(/[ ,]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 18);
  const finalDescription = description.trim() || `${preset.label}${holeNumbers.length ? ` - Hole ${holeNumbers.join(", ")}` : ""}`;
  return (
    <form className="card p-4 flex flex-col gap-3" onSubmit={(e) => {
      e.preventDefault(); setError(null);
      const err = mutate((s) => { createSideBet(s, { roundId: snap.round.id, type, description: finalDescription, amountCents: Math.round(Number(amount) * 100), basis, holeNumbers, opponentIds: opponents }, s.actorId); });
      if (err) setError(err); else { setOpen(false); setOpponents([]); setDescription(""); }
    }}>
      <h3 className="font-display text-lg">New side bet</h3>
      <label><span className="label">Bet type</span><select className="field" value={type} onChange={(e) => setType(e.target.value as SideBetType)}>{SIDE_BET_PRESETS.map((p) => <option key={p.type} value={p.type}>{p.label}</option>)}</select></label>
      <div><span className="label">Opponent(s)</span>
        <div className="flex flex-wrap gap-2">{snap.players.filter((p) => p.playerId !== state.actorId).map((p) => { const on = opponents.includes(p.playerId); return <button key={p.playerId} type="button" aria-pressed={on} onClick={() => setOpponents((o) => (on ? o.filter((x) => x !== p.playerId) : [...o, p.playerId]))} className={`tap rounded-full px-4 text-sm font-semibold border ${on ? "bg-accent text-white border-accent" : "bg-surface border-line-strong"}`}>{p.displayName}</button>; })}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Amount ($)</span><input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label><span className="label">Hole(s)</span><input className="field" inputMode="numeric" placeholder="e.g. 8 or 10,11,12" value={holes} onChange={(e) => setHoles(e.target.value)} /></label>
      </div>
      {preset.autoResolvable && <div><span className="label">Scoring</span><div className="seg"><button type="button" aria-pressed={basis === "GROSS"} onClick={() => setBasis("GROSS")}>Gross</button><button type="button" aria-pressed={basis === "NET"} onClick={() => setBasis("NET")}>Net</button></div></div>}
      <label><span className="label">Description</span><input className="field" placeholder={finalDescription} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <p className="text-xs text-muted">Extra, separate from existing games. Terms lock once every opponent accepts. Switch to the opponent at the top to accept.</p>
      {error && <p className="text-sm text-neg">{error}</p>}
      <div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={opponents.length === 0}>Send bet</Button></div>
    </form>
  );
}

/* ---------- finish ---------- */
function FinishTab({ snap }: { snap: Snapshot }) {
  const { state, mutate, nav } = useApp();
  const roundId = snap.round.id;
  const problems = finishProblems(state, roundId);
  const names = Object.fromEntries(snap.players.map((p) => [p.playerId, p.displayName]));
  const settlements = snap.games.flatMap((g) => g.settlements.map((st) => ({ ...st, game: g.name })));
  const wagered = settlements.reduce((a, s) => a + s.amountCents, 0);
  const [error, setError] = useState<string | null>(null);
  return (
    <Page>
      <h2 className="font-display text-2xl">Finish round</h2>
      {problems.length > 0 && (
        <Card title="Before you can lock">
          <ul className="text-sm space-y-1.5">{problems.map((p, i) => <li key={i} className="flex gap-2 text-neg"><span aria-hidden>•</span>{p}</li>)}</ul>
          <div className="grid grid-cols-2 gap-2 mt-3"><Button variant="secondary" className="text-sm" onClick={() => nav({ name: "round", roundId, tab: "score" })}>Fix scores</Button><Button variant="secondary" className="text-sm" onClick={() => nav({ name: "round", roundId, tab: "games" })}>Resolve bets</Button></div>
        </Card>
      )}
      <Card title="Recap">
        <ul className="divide-y divide-line text-sm">{snap.leaderboardNet.map((r) => <li key={r.playerId} className="flex items-center justify-between py-2"><span className="font-medium">{r.tied ? "T" : ""}{r.position}. {r.displayName}</span><span>{r.gross} gross / <span className="font-semibold">{r.net} net</span> <ToPar value={r.netToPar} className="text-xs" /></span></li>)}</ul>
        <ul className="mt-3 space-y-1 text-sm">
          {snap.games.map((g) => <li key={g.id}><span className="text-muted">{g.name}:</span> {g.summary.headline}</li>)}
          {snap.sideBets.filter((b) => b.status === "SETTLED").map((b) => <li key={b.id}><span className="text-muted">Side bet:</span> {b.resolution?.winnerPlayerId ? `${names[b.resolution.winnerPlayerId]} wins ${b.terms.description}` : b.terms.description}</li>)}
        </ul>
        <p className="text-sm font-semibold mt-3">{money(wagered)} in game wagers to post</p>
      </Card>
      {settlements.length > 0 && (
        <Card title="Ledger entries to post">
          <ul className="divide-y divide-line text-sm">{settlements.map((st, i) => <li key={i} className="py-1.5 flex items-center justify-between"><span>{names[st.fromPlayerId]} → {names[st.toPlayerId]} <span className="text-muted">· {st.game}: {st.memo}</span></span><span className="font-semibold">{money(st.amountCents)}</span></li>)}</ul>
        </Card>
      )}
      {error && <p className="text-sm text-neg">{error}</p>}
      <Button disabled={problems.length > 0} onClick={() => { const err = mutate((s) => finishRound(s, roundId)); if (err) setError(err); else nav({ name: "trip", tripId: snap.round.tripId }); }}>Lock round & post results</Button>
      <p className="text-xs text-muted text-center">Locking makes scores read-only, posts ledger entries, and {snap.round.countsTowardTrip ? "adds this round to trip standings" : "keeps this round standalone"}. Organizers can reopen with an audited correction.</p>
    </Page>
  );
}


/** Scorecard strip: every hole across, a row per player, gross / net / both, putts in the corner, money so far. */
function MiniScorecard({ snap, current, view, onView, onHole }: { snap: Snapshot; current: number; view: ScorecardView; onView: (v: ScorecardView) => void; onHole: (hole: number) => void }) {
  // Nine at a time so nothing is crammed or hidden; follows the hole you're on.
  const [pick, setPick] = useState<{ forHole: number; nine: "front" | "back" } | null>(null);
  const nine: "front" | "back" = pick?.forHole === current ? pick.nine : current <= 9 ? "front" : "back";
  const setNine = (n: "front" | "back") => setPick({ forHole: current, nine: n });
  const holes = nine === "front" ? snap.holes.slice(0, 9) : snap.holes.slice(9);
  const segKey = nine === "front" ? "out" : "in";
  const mark = (toPar: number | null) => (toPar === null ? "" : toPar <= -2 ? "score-double-circle" : toPar === -1 ? "score-circle" : toPar === 1 ? "score-square" : toPar >= 2 ? "score-double-square" : "");
  const num = (value: number | null, toPar: number | null, small = false) => (
    value === null ? <span className="text-line-strong">·</span> : <span className={`inline-flex items-center justify-center ${small ? "h-4 min-w-4 text-[10px]" : "h-6 min-w-6 text-[13px]"} px-0.5 font-display ${mark(toPar)}`}>{value}</span>
  );
  const fmt = (seg: { holesPlayed: number; gross: number; net: number }) => (!seg.holesPlayed ? "–" : view === "gross" ? seg.gross : view === "net" ? seg.net : `${seg.gross}/${seg.net}`);
  return (
    <div className="card !p-0 overflow-hidden" data-testid="mini-scorecard">
      <div className="flex items-center justify-between px-2 pt-1.5">
        <div className="seg !gap-0.5 w-28" aria-label="Which nine">{(["front", "back"] as const).map((n) => <button key={n} type="button" aria-pressed={nine === n} onClick={() => setNine(n)} className="!min-h-7 !text-[11px]">{n === "front" ? "1–9" : "10–18"}</button>)}</div>
        <div className="seg !gap-0.5 w-36" aria-label="Scorecard view">{(["gross", "net", "both"] as ScorecardView[]).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)} className="!min-h-7 !text-[11px] capitalize">{v}</button>)}</div>
      </div>
      <div className="overflow-hidden">
        <table className="text-[11px] leading-none border-separate border-spacing-0 w-full table-fixed">
          <thead>
            <tr className="text-muted">
              <th className="text-left font-semibold px-1.5 py-1.5 w-[58px]">Hole</th>
              {holes.map((h) => (
                <th key={h.holeNumber} className={`px-0 py-1.5 text-center font-semibold ${h.holeNumber === current ? "bg-brass-soft text-ink rounded-t-md" : ""}`}>
                  <button type="button" className="w-full" onClick={() => onHole(h.holeNumber)} aria-label={`Go to hole ${h.holeNumber}`} aria-current={h.holeNumber === current ? "true" : undefined}>{h.holeNumber}</button>
                </th>
              ))}
              <th className={`px-1 py-1.5 text-right font-semibold ${view === "both" ? "w-11" : "w-8"}`}>{nine === "front" ? "Out" : "In"}</th>
              <th className={`px-1.5 py-1.5 text-right font-semibold ${view === "both" ? "w-14" : "w-10"}`}>Tot</th>
            </tr>
            <tr className="text-muted">
              <td className="px-1.5 pb-1 text-[9px] uppercase tracking-wide">Par</td>
              {holes.map((h) => <td key={h.holeNumber} className={`pb-1 text-center text-[9px] ${h.holeNumber === current ? "bg-brass-soft" : ""}`}>{h.par}</td>)}
              <td className="px-1 pb-1 text-right text-[9px]">{holes.reduce((a, h) => a + h.par, 0)}</td>
              <td className="px-1.5 pb-1 text-right text-[9px]">{snap.holes.reduce((a, h) => a + h.par, 0)}</td>
            </tr>
          </thead>
          <tbody>
            {snap.players.map((p) => {
              const t = snap.totals[p.playerId];
              const cash = liveMoney(snap, p.playerId);
              return (
                <tr key={p.playerId}>
                  <td className="px-1.5 py-1 whitespace-nowrap border-t border-line align-middle overflow-hidden">
                    <div className="font-semibold truncate">{p.displayName.split(" ")[0]}</div>
                    <div className={`text-[10px] font-semibold ${cash > 0 ? "text-brass" : cash < 0 ? "text-neg" : "text-muted"}`} data-testid="strip-money">{money(cash, { sign: true })}</div>
                  </td>
                  {holes.map((h) => {
                    const line = t.holes.find((x) => x.holeNumber === h.holeNumber);
                    const putts = snap.entries.find((e) => e.playerId === p.playerId && e.holeNumber === h.holeNumber)?.putts ?? null;
                    return (
                      <td key={h.holeNumber} className={`relative py-1 text-center border-t border-line align-middle ${h.holeNumber === current ? "bg-brass-soft" : ""}`} onClick={() => onHole(h.holeNumber)}>
                        {putts !== null && line?.gross !== null && <span className="absolute top-0.5 right-0.5 text-[7px] leading-none text-muted" aria-label={`${putts} putts`}>{putts}</span>}
                        {view === "gross" && num(line?.gross ?? null, line?.grossToPar ?? null)}
                        {view === "net" && num(line?.net ?? null, line?.netToPar ?? null)}
                        {view === "both" && <div className="flex flex-col items-center gap-0.5">{num(line?.gross ?? null, line?.grossToPar ?? null)}{num(line?.net ?? null, line?.netToPar ?? null, true)}</div>}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-right border-t border-line font-display text-[12px] whitespace-nowrap text-ink-2">{fmt(t[segKey])}</td>
                  <td className="px-1.5 py-1 text-right border-t border-line font-display text-[13px] font-semibold whitespace-nowrap">{fmt(t.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


/** Load the real hole outlines for this course from OpenStreetMap (free, fetched in the browser). */
function CourseMapCard({ snap }: { snap: Snapshot }) {
  const { state, mutate } = useApp();
  const loaded = state.courseGeometry?.[snap.round.courseId] ?? null;
  const [name, setName] = useState(snap.course.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setBusy(true); setError(null);
    try {
      const course = await fetchRealCourse(name);
      mutate((s) => setCourseGeometry(s, snap.round.courseId, course));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the course");
    } finally { setBusy(false); }
  };
  const mapped = loaded ? Object.keys(loaded.holes).length : 0;
  return (
    <Card title="Course map" action={loaded ? <span className="text-xs text-brass font-semibold">{mapped} of {snap.holes.length} holes from the map</span> : <span className="text-xs text-muted">generated layout</span>}>
      {loaded ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p className="text-ink-2">Hole shapes for <b>{loaded.name}</b> come from OpenStreetMap. Holes it hasn&apos;t mapped fall back to the drawn layout.</p>
          <button type="button" className="btn btn-secondary !min-h-9 text-xs whitespace-nowrap" onClick={() => mutate((s) => setCourseGeometry(s, snap.round.courseId, null))}>Use drawn</button>
        </div>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}>
          <p className="text-sm text-muted">Pull the real tees, fairways, greens, bunkers and water for this course from OpenStreetMap. Free; works for any course mappers have drawn.</p>
          <div className="flex gap-2">
            <input className="field !min-h-10 flex-1" value={name} onChange={(e) => setName(e.target.value)} aria-label="Course name on the map" placeholder="Course name as on the map" />
            <button type="submit" className="btn btn-primary !min-h-10 text-sm whitespace-nowrap" disabled={busy || !name.trim()} data-testid="load-course">{busy ? "Loading…" : "Load real course"}</button>
          </div>
          {error && <p className="text-sm text-neg" data-testid="course-error">{error}</p>}
        </form>
      )}
    </Card>
  );
}
