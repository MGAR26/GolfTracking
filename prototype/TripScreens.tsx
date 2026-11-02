/**
 * The screens around the round: the first-run setup, the empty state before any trip, the trip's
 * front door, the round story shown when a round is locked, and the settle-up page for a trip.
 * Photography lives in prototype/art (made for the app, no real course is named on it); a named
 * course always shows its own satellite photo.
 */
import { useState } from "react";
import { useApp } from "./App";
import { Button, Card } from "./ui";
import { SettleUpList } from "./SettleUp";
import { holeShapeFor, holeShots, isPaid, roundSettlement, roundSnapshot, sgBaseline, togglePaid, tripDashboard, type Snapshot, type State } from "./store";
import { holeStrokesGained } from "./strokesGained";
import { formatDateRange, formatTime, money, plural } from "../src/lib/format";

/* ---------- shared bits ---------- */
export const ART = { fairway: "art/fairway.jpg", dusk: "art/dusk.jpg", porch: "art/porch.jpg", aerial: "art/aerial.jpg", terrace: "art/terrace.jpg", icon: "art/icon.jpg" };
const FIRST_RUN = "gto-proto:first-run:v1";
export function firstRunDone(): boolean { try { return window.localStorage.getItem(FIRST_RUN) === "1"; } catch { return true; } }
function markFirstRun() { try { window.localStorage.setItem(FIRST_RUN, "1"); } catch { /* convenience only */ } }

/** The course's own photo (hole 1's satellite bake) when it has one, otherwise the drone shot. */
function coursePhoto(state: State, courseId: string | null | undefined): string {
  if (!courseId) return ART.aerial;
  try { return holeShapeFor(state, courseId, 1).photo?.src ?? ART.aerial; } catch { return ART.aerial; }
}
const AV_COLORS = ["#1b2a41", "#7a1f2b", "#b08d3c", "#4b5568", "#2f6b3a", "#6b4a2a"];
function Avatar({ name, i }: { name: string; i: number }) {
  return <span className="h-7 w-7 rounded-full grid place-items-center text-[12px] font-bold text-[var(--bg)] shrink-0" style={{ background: AV_COLORS[i % AV_COLORS.length] }} aria-hidden>{name[0]}</span>;
}
const Eyebrow = ({ children, light = false }: { children: React.ReactNode; light?: boolean }) => <div className={`text-[10px] uppercase tracking-[.16em] font-bold ${light ? "text-[#e9cf8f]" : "text-brass"}`}>{children}</div>;
const dayName = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short" }) : "");
const minutesUntil = (iso: string | null) => (iso ? Math.round((new Date(iso).getTime() - Date.now()) / 60000) : null);

/* ================= First run ================= */
/** Shown once per phone: add to the home screen and turn on location, with the reason stated. */
export function FirstRunScreen({ onDone }: { onDone: () => void }) {
  const [asked, setAsked] = useState(false);
  const finish = () => { markFirstRun(); onDone(); };
  const askLocation = () => {
    setAsked(true);
    try { navigator.geolocation?.getCurrentPosition(() => finish(), () => finish(), { timeout: 4000 }); } catch { finish(); }
    window.setTimeout(finish, 4500);
  };
  const installed = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  return (
    <div className="fixed inset-0 flex flex-col text-[var(--bg)] bg-ink" data-testid="first-run" style={{ backgroundImage: `url(${ART.fairway})`, backgroundSize: "cover", backgroundPosition: "center top" }}>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(14,23,38,.45) 0%, rgba(14,23,38,0) 22%, rgba(14,23,38,.1) 42%, rgba(14,23,38,.9) 62%, #0e1726 100%)" }} aria-hidden />
      <div className="relative flex flex-col flex-1 px-6 pb-6 pt-[max(28px,env(safe-area-inset-top))] gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[.18em]"><img src={ART.icon} alt="" className="h-6 w-6 rounded-[7px]" />Golf Trip OS</div>
        <div className="flex-1" />
        <Eyebrow light>Before the first tee</Eyebrow>
        <h1 className="font-display text-[34px] leading-[1.02]">Two things so it works in the pines</h1>
        <p className="text-sm text-[rgba(247,243,234,.82)] leading-snug">Courses lose signal. The app keeps the round on your phone and catches everyone up when you are back.</p>
        <ul className="flex flex-col gap-2 mt-1">
          <li className={`grid grid-cols-[34px_1fr] gap-3 items-center rounded-2xl px-3.5 py-2.5 text-sm border ${installed ? "border-[rgba(247,243,234,.16)]" : "border-[rgba(247,243,234,.16)]"} bg-[rgba(247,243,234,.1)] backdrop-blur`}>
            <span className={`h-[34px] w-[34px] rounded-full grid place-items-center font-display text-lg ${installed ? "bg-pos text-white" : "bg-[rgba(233,207,143,.18)] text-[#e9cf8f]"}`}>{installed ? "✓" : "1"}</span>
            <span>Add to home screen<small className="block text-xs text-[rgba(247,243,234,.65)]">{installed ? "Done. Opens full screen, works offline" : "Share → Add to Home Screen. Opens full screen, works offline"}</small></span>
          </li>
          <li className="grid grid-cols-[34px_1fr] gap-3 items-center rounded-2xl px-3.5 py-2.5 text-sm border border-[rgba(247,243,234,.16)] bg-[rgba(247,243,234,.1)] backdrop-blur">
            <span className="h-[34px] w-[34px] rounded-full grid place-items-center font-display text-lg bg-[rgba(233,207,143,.18)] text-[#e9cf8f]">2</span>
            <span>Turn on location<small className="block text-xs text-[rgba(247,243,234,.65)]"><span className="inline-block h-[7px] w-[7px] rounded-full bg-[#7fc48a] mr-1.5 align-[1px]" />Marks your ball where you stand</small></span>
          </li>
        </ul>
        <button type="button" onClick={askLocation} disabled={asked} className="btn btn-primary w-full mt-1" data-testid="first-run-location">{asked ? "Asking…" : "Turn on location"}</button>
        <button type="button" onClick={finish} className="text-xs text-[rgba(247,243,234,.6)] text-center py-1" data-testid="first-run-skip">Not now</button>
      </div>
    </div>
  );
}

/* ================= No trip yet ================= */
export function NoTripScreen() {
  const { nav } = useApp();
  return (
    <div className="fixed inset-0 flex flex-col bg-surface" data-testid="no-trip">
      <div className="relative h-[52%] shrink-0" style={{ backgroundImage: `url(${ART.porch})`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div className="absolute inset-x-0 bottom-0 h-28" style={{ background: "linear-gradient(180deg, rgba(247,243,234,0), var(--bg))" }} aria-hidden />
        <div className="absolute left-5 top-[max(28px,env(safe-area-inset-top))] flex items-center gap-2 text-[11px] uppercase tracking-[.18em] text-[var(--bg)]" style={{ textShadow: "0 1px 6px rgba(14,23,38,.5)" }}><img src={ART.icon} alt="" className="h-6 w-6 rounded-[7px]" />Golf Trip OS</div>
      </div>
      <div className="relative -mt-5 flex flex-1 flex-col gap-3 px-6 pb-[max(24px,env(safe-area-inset-bottom))]">
        <Eyebrow>Welcome</Eyebrow>
        <h1 className="font-display text-[34px] leading-[1.02]">The trip starts on the porch</h1>
        <p className="text-sm text-ink-2 leading-snug">Add the crew, the courses and the bets. Everyone scores on their own phone and the money settles itself.</p>
        <div className="flex-1" />
        <Button className="w-full" onClick={() => nav({ name: "newTrip" })}>Start a trip</Button>
        <p className="text-center text-[13px] font-semibold text-ink-2">Join with a code <span className="text-muted font-normal">· soon</span></p>
      </div>
    </div>
  );
}

/* ================= Trip home ================= */
export function TripHomeScreen({ tripId }: { tripId: string }) {
  const { state, nav } = useApp();
  const d = tripDashboard(state, tripId);
  const byStart = [...d.recaps].sort((a, b) => (a.round.startsAt ?? "").localeCompare(b.round.startsAt ?? ""));
  const live = d.liveRound ? d.recaps.find((r) => r.round.id === d.liveRound!.id) ?? null : null;
  // today's round: the live one, else the next one that has not been locked
  const today = live ?? byStart.find((r) => r.round.status === "LIVE") ?? byStart.find((r) => r.round.status !== "LOCKED") ?? byStart[byStart.length - 1] ?? null;
  const dayIndex = today ? byStart.indexOf(today) + 1 : 0;
  const mins = today ? minutesUntil(today.round.startsAt) : null;
  const leader = d.standings.reduce<typeof d.standings[number] | null>((a, s) => (a === null || s.moneyCents > a.moneyCents ? s : a), null);
  const board = [...d.standings].sort((a, b) => b.moneyCents - a.moneyCents);
  const counted = d.recaps.filter((r) => r.round.status === "LOCKED").length;
  const players = (ids: string[]) => ids.map((id) => d.members.find((m) => m.id === id)?.name.split(" ")[0] ?? "?").join(" · ");
  return (
    <div className="min-h-full bg-surface pb-[max(24px,env(safe-area-inset-bottom))]" data-testid="trip-home">
      <div className="relative h-[300px] text-[var(--bg)]" style={{ backgroundImage: `url(${coursePhoto(state, today?.round.courseId)})`, backgroundSize: "cover", backgroundPosition: "center 35%" }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(27,42,65,.45) 0%, rgba(27,42,65,.05) 35%, rgba(27,42,65,.8) 100%)" }} aria-hidden />
        <div className="absolute left-4 right-4 top-[max(14px,env(safe-area-inset-top))] flex items-center justify-between text-[11px] uppercase tracking-[.14em]">
          <button type="button" onClick={() => nav({ name: "home" })} className="tap !min-h-8 flex items-center gap-2" aria-label="All trips"><span className="text-lg leading-none">‹</span><img src={ART.icon} alt="" className="h-[22px] w-[22px] rounded-md" />{d.trip.name}</button>
          <span>{d.recaps.length ? `Day ${dayIndex} of ${d.recaps.length}` : formatDateRange(d.trip.startDate, d.trip.endDate)}</span>
        </div>
        <div className="absolute left-4 right-4 bottom-8">
          <Eyebrow light>{today ? (today.round.status === "LIVE" ? "Live now" : today.round.status === "LOCKED" ? "Last round" : "Up next") : "No rounds yet"}</Eyebrow>
          <h1 className="font-display text-[36px] leading-none mt-1 mb-2" data-testid="trip-course">{today ? today.course.name : d.trip.destination ?? d.trip.name}</h1>
          <p className="text-[13px] opacity-90">{today ? `${today.course.teeName} tees · ${today.course.courseRating} / ${today.course.slopeRating}` : "Add the first round below"}</p>
        </div>
      </div>

      {today ? (
        <div className="relative z-10 -mt-[22px] mx-4 rounded-2xl bg-surface p-3.5 flex items-center gap-3 shadow-[0_10px_30px_rgba(27,42,65,.14)]" data-testid="tee-card">
          <div className="font-display text-[30px] leading-none">{today.round.startsAt ? formatTime(today.round.startsAt) : "—"}</div>
          <div className="flex-1 min-w-0">
            <b className="block text-sm">{today.round.status === "LIVE" ? `Thru ${today.holesComplete}` : today.round.status === "LOCKED" ? (today.leader ? `${today.leader} led on net` : "Locked") : mins === null ? today.round.name : mins > 0 && mins < 180 ? `Tee time in ${mins} min` : today.round.name}</b>
            <span className="text-xs text-ink-2 truncate block">{players(today.round.players.map((p) => p.playerId))}</span>
          </div>
          <button type="button" onClick={() => nav(today.round.status === "LOCKED" ? { name: "story", roundId: today.round.id } : { name: "round", roundId: today.round.id, tab: "score" })} className="btn btn-primary !min-h-10 px-4 text-sm" data-testid="tee-play">{today.round.status === "LOCKED" ? "Story" : "Play"}</button>
        </div>
      ) : (
        <div className="relative z-10 -mt-[22px] mx-4"><Button className="w-full" onClick={() => nav({ name: "newRound", tripId })}>Add the first round</Button></div>
      )}

      <section className="px-4 pt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between"><span className="label !mb-0">Money board · {counted ? `through ${plural(counted, "round")}` : "nothing locked yet"}</span><button type="button" onClick={() => nav({ name: "money", tripId })} className="text-xs font-semibold text-accent">Settle up ›</button></div>
        <ul className="rounded-2xl bg-surface-2/60 overflow-hidden" data-testid="money-board">
          {board.map((s, i) => (
            <li key={s.playerId} className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5 px-3.5 py-2 border-t border-line first:border-t-0 text-sm">
              <Avatar name={s.displayName} i={d.members.findIndex((m) => m.id === s.playerId)} />
              <span className="font-medium truncate">{s.displayName}{leader && leader.playerId === s.playerId && leader.moneyCents > 0 && <span className="ml-2 text-[9px] uppercase tracking-[.12em] text-brass font-bold">Leader</span>}</span>
              <span className={`font-display text-xl tabular-nums ${s.moneyCents > 0 ? "text-pos" : s.moneyCents < 0 ? "text-neg" : "text-muted"}`}>{money(s.moneyCents, { sign: true })}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between"><span className="label !mb-0">The trip</span><button type="button" onClick={() => nav({ name: "newRound", tripId })} className="text-xs font-semibold text-accent">+ Round</button></div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" data-testid="trip-days">
          {byStart.length === 0 && <p className="text-sm text-muted">No rounds yet.</p>}
          {byStart.map((r) => {
            const isToday = today?.round.id === r.round.id;
            const done = r.round.status === "LOCKED";
            return (
              <button key={r.round.id} type="button" onClick={() => nav(done ? { name: "story", roundId: r.round.id } : { name: "round", roundId: r.round.id, tab: r.round.status === "LIVE" ? "score" : "overview" })} className={`shrink-0 w-[124px] rounded-2xl bg-surface-2/60 px-3 py-2.5 text-left ${isToday ? "outline outline-2 outline-brass" : ""}`}>
                <div className="text-[10px] uppercase tracking-[.12em] text-muted font-semibold">{dayName(r.round.startsAt) || "Round"}{done ? " · done" : isToday ? " · today" : ""}</div>
                <div className="font-display text-[15px] leading-tight my-1 line-clamp-2">{r.course.name}</div>
                <div className="text-[11px] text-ink-2 truncate">{done ? (r.leader ? `${r.leader} won` : "Final") : `${r.round.startsAt ? formatTime(r.round.startsAt) : ""}${r.round.games.length ? ` · ${r.round.games[0].name}` : ""}`}</div>
              </button>
            );
          })}
        </div>
      </section>

      <button type="button" onClick={() => nav({ name: "newTrip" })} className="relative mx-4 mt-4 h-[78px] w-[calc(100%-2rem)] rounded-2xl overflow-hidden text-left text-[var(--bg)] flex items-center px-3.5" style={{ backgroundImage: `url(${ART.aerial})`, backgroundSize: "cover", backgroundPosition: "center 40%" }} data-testid="plan-next">
        <span className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(14,23,38,.88) 30%, rgba(14,23,38,.1))" }} aria-hidden />
        <span className="relative"><b className="font-display font-normal text-xl block">Plan the next one</b><span className="text-xs opacity-85">Pick courses, dates and the crew</span></span>
      </button>

      <section className="px-4 pt-4">
        <Card title="Players">
          <ul className="grid grid-cols-2 gap-2 text-sm">{d.members.map((m, i) => <li key={m.id} className="flex items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-2"><Avatar name={m.name} i={i} /><span className="min-w-0"><span className="font-medium block truncate">{m.name}</span><span className="text-xs text-ink-2">HI {m.handicapIndex.toFixed(1)}</span></span></li>)}</ul>
        </Card>
      </section>
    </div>
  );
}

/* ================= Round story ================= */
/** One screen for the group chat: the score, what it cost, what you won. */
export function RoundStoryScreen({ roundId }: { roundId: string }) {
  const { state, nav, back } = useApp();
  const snap = roundSnapshot(state, roundId);
  const me = snap.players.find((p) => p.playerId === state.actorId) ?? snap.players[0];
  const t = snap.totals[me.playerId]; const st = snap.stats[me.playerId];
  const place = snap.leaderboardNet.findIndex((r) => r.playerId === me.playerId) + 1;
  const birdies = t.holes.filter((h) => h.grossToPar !== null && h.grossToPar <= -1).length;
  const won = roundSettlement(snap).payments.reduce((a, p) => a + (p.toPlayerId === me.playerId ? p.amountCents : 0) - (p.fromPlayerId === me.playerId ? p.amountCents : 0), 0);
  const cost = costliest(state, snap, me.playerId);
  const [copied, setCopied] = useState<string | null>(null);
  const summary = `${me.displayName} shot ${t.total.gross} (${fmt(t.total.grossToPar)}) at ${snap.course.name}, net ${t.total.net}${won ? `, ${won > 0 ? "won" : "lost"} ${money(Math.abs(won))}` : ""}.`;
  const share = () => {
    try { navigator.clipboard?.writeText(summary).then(() => setCopied("Copied for the group chat"), () => setCopied("Copy is blocked here; screenshot this instead")); } catch { setCopied("Screenshot this for the group chat"); }
  };
  return (
    <div className="fixed inset-0 overflow-y-auto text-[var(--bg)]" style={{ background: "#0e1726", backgroundImage: `url(${ART.dusk})`, backgroundSize: "100% auto", backgroundRepeat: "no-repeat", backgroundPosition: "center top" }} data-testid="round-story">
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(14,23,38,0) 0%, rgba(14,23,38,.1) 30%, rgba(14,23,38,.9) 50%, #0e1726 100%)" }} aria-hidden />
      <div className="relative min-h-full flex flex-col">
        <button type="button" onClick={back} className="absolute left-3 top-[max(10px,env(safe-area-inset-top))] tap !min-h-9 px-2 text-2xl leading-none" aria-label="Back">‹</button>
        <div className="h-[300px] shrink-0 flex items-end px-5 pb-1">
          <div>
            <Eyebrow light>{snap.round.startsAt ? new Date(snap.round.startsAt).toLocaleDateString("en-US", { weekday: "long" }) : "Round"} · {snap.course.name}</Eyebrow>
            <h1 className="font-display text-[46px] leading-[.95] mt-1" data-testid="story-headline">{me.displayName.split(" ")[0]} shot {t.total.gross}</h1>
            <p className="text-[13px] opacity-85 mt-1">{fmt(t.total.grossToPar)} · net {t.total.net} · {plural(birdies, "birdie")}{place ? ` · ${ordinal(place)} of ${snap.players.length} on net` : ""}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 px-5 pt-4">
          <Stat label="Fairways" v={st.fairwayOpportunities ? String(st.fairwaysHit) : "—"} sub={st.fairwayOpportunities ? `/${st.fairwayOpportunities}` : ""} />
          <Stat label="Greens" v={st.girOpportunities ? String(st.girs) : "—"} sub={st.girOpportunities ? `/${st.girOpportunities}` : ""} />
          <Stat label="Putts" v={st.putts === null ? "—" : String(st.putts)} />
        </div>
        <div className="px-5 pt-4 flex flex-col gap-2">
          <div className="text-[9px] uppercase tracking-[.14em] font-semibold text-[rgba(247,243,234,.6)]">{cost.tracked ? "What it cost you" : "The holes that cost you"}</div>
          {cost.lines.length === 0 && <p className="text-sm opacity-80">Clean card. Nothing to point at.</p>}
          {cost.lines.map((l) => (
            <div key={l.hole} className="grid grid-cols-[30px_1fr_auto] gap-2.5 items-baseline text-[13px]">
              <span className="font-display text-xl text-[#e9cf8f]">{l.hole}</span><span>{l.text}</span><span className="font-bold text-[#e3a3a3] tabular-nums">{l.value}</span>
            </div>
          ))}
        </div>
        <div className="mx-5 mt-4 rounded-2xl border border-[rgba(247,243,234,.15)] bg-[rgba(247,243,234,.08)] px-3.5 py-2.5 flex items-center justify-between text-[13px]">
          <span>{snap.games.map((g) => g.name).join(" and ") || "Side bets"} today</span>
          <b className={`font-display font-normal text-[22px] tabular-nums ${won > 0 ? "text-[#9cc873]" : won < 0 ? "text-[#e3a3a3]" : ""}`} data-testid="story-won">{won === 0 ? "even" : money(won, { sign: true })}</b>
        </div>
        <div className="flex-1" />
        {copied && <p className="text-center text-xs opacity-80 px-5 pt-3">{copied}</p>}
        <div className="flex gap-2 px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]">
          <button type="button" onClick={share} className="flex-1 rounded-xl bg-brass text-ink font-bold text-[13px] py-3" data-testid="story-share">Share to the group</button>
          <button type="button" onClick={() => nav({ name: "round", roundId, tab: "stats" })} className="flex-1 rounded-xl border border-[rgba(247,243,234,.3)] font-semibold text-[13px] py-3">Replay</button>
        </div>
      </div>
    </div>
  );
}
const fmt = (toPar: number) => (toPar === 0 ? "E" : toPar > 0 ? `+${toPar}` : `${toPar}`);
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] ?? "th"}`;
function Stat({ label, v, sub }: { label: string; v: string; sub?: string }) {
  return <div className="border-t border-[rgba(247,243,234,.18)] pt-2"><div className="text-[9px] uppercase tracking-[.14em] font-semibold text-[rgba(247,243,234,.6)]">{label}</div><div className="font-display text-[26px] leading-tight">{v}{sub && <small className="font-sans text-xs opacity-70 ml-0.5">{sub}</small>}</div></div>;
}
/** The three holes that cost the most: strokes gained from tracked shots when there are any, else score against par. */
function costliest(state: State, snap: Snapshot, playerId: string): { tracked: boolean; lines: { hole: number; text: string; value: string }[] } {
  const player = state.players.find((p) => p.id === playerId);
  const hi = player?.handicapIndex ?? 15;
  const tracked = snap.holes.map((h) => {
    const shots = holeShots(snap.round, playerId, h.holeNumber);
    if (shots.length === 0) return null;
    const shape = holeShapeFor(state, snap.round.courseId, h.holeNumber);
    const sg = holeStrokesGained(shots, shape.green.c, h.par, hi, sgBaseline(state));
    const worst = shots.map((s) => ({ s, g: sg.byId[s.id]?.gained ?? 0 })).sort((a, b) => a.g - b.g)[0];
    const putts = shots.filter((s) => s.club === "putt").length;
    const firstPutt = shots.find((s) => s.club === "putt");
    const text = worst.s.club === "putt" && firstPutt
      ? `${putts === 3 ? "Three" : putts === 4 ? "Four" : putts} putts from ${Math.round(Math.hypot(firstPutt.from.u - shape.green.c.u, firstPutt.from.v - shape.green.c.v) * 3)} ft`
      : shotWords(worst.s, Math.round(Math.hypot(worst.s.from.u - shape.green.c.u, worst.s.from.v - shape.green.c.v)));
    return { hole: h.holeNumber, total: sg.totals.total, text };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (tracked.length >= 3) {
    return { tracked: true, lines: tracked.sort((a, b) => a.total - b.total).slice(0, 3).filter((x) => x.total < -0.3).map((x) => ({ hole: x.hole, text: x.text, value: `${x.total.toFixed(1)}` })) };
  }
  const t = snap.totals[playerId];
  const bad = t.holes.filter((h) => h.grossToPar !== null && h.grossToPar >= 1).sort((a, b) => (b.grossToPar ?? 0) - (a.grossToPar ?? 0)).slice(0, 3);
  return { tracked: false, lines: bad.map((h) => ({ hole: h.holeNumber, text: h.grossToPar === 1 ? "Bogey" : h.grossToPar === 2 ? "Double bogey" : `${h.grossToPar! + 0} over`, value: `+${h.grossToPar}` })) };
}
/** "Tee shot into the rough from 418": the kind of shot by where it started, and where it ended up. */
function shotWords(s: { club: string; lie: string | null; seq: number }, from: number): string {
  const kind = s.club === "chip" || from < 40 ? "Chip" : s.seq === 1 && from > 230 ? "Tee shot" : "Approach";
  const where = s.lie === "sand" ? "into the bunker" : s.lie === "water" ? "into the water" : s.lie === "rough" ? "into the rough" : s.lie === "green" ? "left a long putt" : s.lie === "fairway" ? "left short" : "";
  return `${kind} ${where} from ${from}`.replace("  ", " ");
}

/* ================= Settle up ================= */
export function SettleScreen({ tripId }: { tripId: string }) {
  const { state, nav, mutate } = useApp();
  const d = tripDashboard(state, tripId);
  const name = (id: string) => d.members.find((m) => m.id === id)?.name ?? "?";
  const top = [...d.standings].sort((a, b) => b.moneyCents - a.moneyCents)[0];
  const over = d.recaps.length > 0 && d.recaps.every((r) => r.round.status === "LOCKED");
  const open = d.settlement.payments.filter((p) => !isPaid(state, tripId, p));
  const paid = d.settlement.payments.filter((p) => isPaid(state, tripId, p));
  const active = d.ledger.filter((e) => e.status !== "REVERSED");
  return (
    <div className="min-h-full bg-surface pb-[max(24px,env(safe-area-inset-bottom))]" data-testid="settle-screen">
      <div className="relative h-[300px] flex items-end text-[var(--bg)]" style={{ backgroundImage: `url(${ART.terrace})`, backgroundSize: "cover", backgroundPosition: "center 60%" }}>
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(14,23,38,.05) 30%, rgba(14,23,38,.85))" }} aria-hidden />
        <button type="button" onClick={() => nav({ name: "trip", tripId })} className="absolute left-3 top-[max(10px,env(safe-area-inset-top))] tap !min-h-9 px-2 text-2xl leading-none" aria-label="Back">‹</button>
        <div className="relative px-5 pb-4">
          <Eyebrow light>{over ? "Trip over" : `${d.trip.name} · so far`}</Eyebrow>
          <h1 className="font-display text-[32px] leading-[1.02] mt-1" data-testid="settle-headline">{top && top.moneyCents > 0 ? `${top.displayName.split(" ")[0]} ${over ? "takes the trip" : "leads"}, ${money(top.moneyCents, { sign: true })}` : "Everyone is even"}</h1>
        </div>
      </div>
      <section className="mx-4 mt-4 rounded-2xl bg-surface-2/60 px-3.5">
        {open.length === 0 && paid.length === 0 && <p className="py-3 text-sm text-muted">Nothing to settle.</p>}
        {open.length > 0 && <SettleUpList payments={open} note={`${d.trip.name} settle-up`} />}
        {paid.map((p) => (
          <div key={`${p.fromPlayerId}-${p.toPlayerId}`} className="flex items-center justify-between gap-2 py-2 border-t border-line text-sm text-muted" data-testid="paid-row">
            <span><span className="font-medium">{name(p.fromPlayerId)}</span> paid {name(p.toPlayerId)}</span>
            <span className="flex items-center gap-2"><span className="line-through tabular-nums">{money(p.amountCents)}</span><button type="button" onClick={() => mutate((s) => togglePaid(s, tripId, p))} className="rounded-full bg-pos text-white text-[11px] font-bold px-2.5 py-1">Paid</button></span>
          </div>
        ))}
      </section>
      {open.length > 0 && (
        <div className="mx-4 mt-2 flex flex-wrap gap-1.5" data-testid="mark-paid">
          {open.map((p) => <button key={`${p.fromPlayerId}-${p.toPlayerId}`} type="button" onClick={() => mutate((s) => togglePaid(s, tripId, p))} className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-semibold">Mark {name(p.fromPlayerId).split(" ")[0]} → {name(p.toPlayerId).split(" ")[0]} paid</button>)}
        </div>
      )}
      {d.settlement.payments.length > 0 && <p className="mx-5 mt-2.5 text-xs text-muted">{plural(d.settlement.payments.length, "payment")} clear{d.settlement.payments.length === 1 ? "s" : ""} everything. Paid ones tick off for the whole group once trips are shared.</p>}
      <section className="px-4 pt-4">
        <Card title="Itemized ledger" action={<span className="text-xs text-muted">{active.length} entries</span>}>
          {active.length === 0 ? <p className="text-sm text-muted">Nothing posted yet. Lock a round or settle a side bet.</p> : (
            <ul className="divide-y divide-line text-sm">{active.map((e) => <li key={e.id} className="py-2"><div className="flex items-center justify-between"><span>{name(e.fromPlayerId)} → {name(e.toPlayerId)}</span><span className="font-semibold">{money(e.amountCents)}</span></div><p className="text-xs text-muted">{e.sourceType === "SIDE_BET" ? "Side bet" : e.sourceType === "GAME" ? "Game" : e.sourceType} · {e.memo}</p></li>)}</ul>
          )}
        </Card>
      </section>
      <div className="px-4 pt-4"><Button className="w-full" onClick={() => nav({ name: "newTrip" })}>{over ? "Book next year" : "Plan the next trip"}</Button></div>
    </div>
  );
}
