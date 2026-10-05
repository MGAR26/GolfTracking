/**
 * Caddie wording: two or three plain sentences built from the strategy simulation, the hazards
 * ahead and the club the player has picked. Rule-based so it works offline and costs nothing;
 * the real app can hand the same facts to a language model later for tone, never for numbers.
 */
import { dist, type HazardDistance, type Pt } from "./holeGeometry";
import { DRIFT_PER_MPH_PER_YD, windFor, type FlightEnv } from "./flight";
import type { Club } from "./shots";
import type { Simulation, Strategy } from "./strategy";

export interface CaddieAdvice { headline: string; lines: string[] }

const CLUB_WORDS: Record<Club, string> = { Dr: "Driver", "3W": "3-wood", "5W": "5-wood", Hy: "Hybrid", "4i": "4-iron", "5i": "5-iron", "6i": "6-iron", "7i": "7-iron", "8i": "8-iron", "9i": "9-iron", PW: "Pitching wedge", GW: "Gap wedge", SW: "Sand wedge", LW: "Lob wedge" };
export const clubWords = (c: Club) => CLUB_WORDS[c];
const lower = (c: Club) => (c === "Dr" ? "driver" : CLUB_WORDS[c].charAt(0).toLowerCase() + CLUB_WORDS[c].slice(1));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const aimWords = (off: number) => (Math.abs(off) < 5 ? "at the middle" : `${Math.abs(off)} yards ${off > 0 ? "right" : "left"}`);
const strokes = (d: number) => `${Math.abs(d).toFixed(1)} stroke${Math.abs(d) >= 0.95 && Math.abs(d) < 1.05 ? "" : "s"}`;
const hazardName = (h: HazardDistance) => `${h.kind === "bunker" ? "the bunker" : h.kind === "water" ? "the water" : "the trees"} ${h.side === "L" ? "left" : "right"}`;
/** How often this play finds that kind of hazard (trees show up as rough in the simulation). */
const hazardOdds = (s: Simulation, h: HazardDistance) => (h.kind === "bunker" ? s.odds.sand : h.kind === "water" ? s.odds.water : null);
/** The play's biggest miss, for the "but" in a comparison. */
function worstMiss(s: Simulation): string | null {
  if (s.odds.water >= 0.04) return `water ${pct(s.odds.water)}`;
  if (s.odds.sand >= 0.12) return `sand ${pct(s.odds.sand)}`;
  if (s.odds.rough >= 0.45) return `rough ${pct(s.odds.rough)}`;
  return null;
}

/** Yards the play sends the ball: the aim point sits at the club's carry. */
const shotLength = (s: Simulation, from: Pt) => dist(from, s.aim);

/** One earlier visit to this hole: the tee club, the play it was, and the score (newest first). */
export interface TeeHistory { club: Club | "chip" | "putt"; kind: "safe" | "balanced" | "attack" | "own" | null; gross: number; par: number }
const SCORE = (d: number) => (d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 0 ? "par" : d === 1 ? "bogey" : d === 2 ? "double" : `+${d}`);
const historyClub = (c: TeeHistory["club"]) => (c === "chip" ? "a chip" : c === "putt" ? "a putt" : lower(c));
/** "Here before: driver (attack) made 4, 3-wood (balanced) made 5." — up to three visits, newest first. */
export function historyLine(history: TeeHistory[]): string | null {
  if (!history.length) return null;
  const parts = history.slice(0, 3).map((h) => `${historyClub(h.club)}${h.kind && h.kind !== "own" ? ` (${h.kind})` : ""} made ${h.gross} (${SCORE(h.gross - h.par)})`);
  const clubs = new Set(history.slice(0, 3).map((h) => h.club));
  if (clubs.size === 1 && history.length > 1) return `Your last ${Math.min(3, history.length)} here off the tee were all ${historyClub(history[0].club)}: made ${history.slice(0, 3).map((h) => h.gross).join(", ")}.`;
  return `Here before: ${parts.join(", ")}.`;
}

/** The wind sentence: how far it moves this shot and how the aim deals with it, plus a head/tail note. */
export function windLine(env: FlightEnv, from: Pt, rec: Simulation): string | null {
  const { head, cross } = windFor(env, from, rec.aim);
  const flight = dist(from, rec.aim);
  const parts: string[] = [];
  if (Math.abs(cross) >= 3) {
    const drift = Math.round(Math.abs(cross) * DRIFT_PER_MPH_PER_YD * flight);
    const dir = cross > 0 ? "left to right" : "right to left";
    const into = rec.aimOffset * cross < 0 && Math.abs(rec.aimOffset) >= 3;
    parts.push(`${Math.round(Math.abs(cross))} mph ${dir} moves it about ${drift} yard${drift === 1 ? "" : "s"}${into ? `, so the aim is ${Math.abs(rec.aimOffset)} ${rec.aimOffset > 0 ? "right" : "left"} and the wind brings it back` : ""}`);
  }
  if (Math.abs(head) >= 4) {
    const yds = Math.round(head > 0 ? flight * 0.01 * head : flight * 0.005 * -head);
    parts.push(head > 0 ? `into ${Math.round(head)} mph costs about ${yds} yards` : `${Math.round(-head)} mph helping adds about ${yds}`);
  }
  if (!parts.length) return null;
  const t = parts.join("; ");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}

export function caddieAdvice({ plan, current, hazards, from, remaining, history = [], env }: { plan: Strategy; current: Simulation | null; hazards: HazardDistance[]; from: Pt; remaining: number; /** Earlier visits, shown on the tee shot only. */ history?: TeeHistory[]; /** Wind and ground: the wind line explains the aim. */ env?: FlightEnv }): CaddieAdvice {
  const rec = plan.recommended;
  const reaches = rec.odds.green >= 0.15 || shotLength(rec, from) >= remaining - 15;
  const headline = reaches
    ? `${clubWords(rec.club)} ${aimWords(rec.aimOffset)}: on the green ${pct(rec.odds.green)} of the time.`
    : `${clubWords(rec.club)} ${aimWords(rec.aimOffset)}, leaves about ${Math.round(rec.leave)}.`;
  const lines: string[] = [];

  // The one hazard that matters: the nearest one this play's landing zone reaches into, and only
  // when the simulation actually finds it (trees have no odds of their own, so they count by distance).
  const len = shotLength(rec, from);
  const reachable = (h: HazardDistance) => len >= h.to - 25 && len <= h.carry + 15;
  const live = (h: HazardDistance) => { const o = hazardOdds(rec, h); return o === null || o >= 0.02; };
  const inPlay = hazards.filter((h) => reachable(h) && live(h)).sort((a, b) => Math.abs(len - (a.to + a.carry) / 2) - Math.abs(len - (b.to + b.carry) / 2))[0];
  if (inPlay) {
    const o = hazardOdds(rec, inPlay);
    const odds = o !== null ? `: this play finds it ${pct(o)} of the time` : "";
    // a hazard that runs along the hole reads as a side to favour, not a carry number
    if (inPlay.carry - inPlay.to > 90) {
      const side = inPlay.side === "L" ? "left" : "right";
      const lead = inPlay.kind === "trees" ? `Trees line the ${side}` : inPlay.kind === "water" ? `Water runs down the ${side}` : `Sand runs down the ${side}`;
      lines.push(`${lead} from ${Math.round(inPlay.to)}${odds}.`);
    }
    else lines.push(`Watch ${hazardName(inPlay)} at ${inPlay.carry - inPlay.to >= 8 ? `${Math.round(inPlay.to)}–${Math.round(inPlay.carry)}` : Math.round(inPlay.to)}${odds}.`);
  } else if (hazards.some((h) => reachable(h) && !live(h))) {
    const h = hazards.find((x) => reachable(x) && !live(x))!;
    lines.push(`Keeps ${hazardName(h)} out of play.`);
  } else {
    const short = hazards.find((h) => h.to > len + 25);
    if (short && !reaches) lines.push(`Stays short of ${hazardName(short)} at ${Math.round(short.to)}.`);
  }

  // What the bolder play buys (or costs), or what the safe play gives up.
  const attack = plan.plays.find((p) => p.kind === "attack")?.sim;
  const safe = plan.plays.find((p) => p.kind === "safe")?.sim;
  const differs = (s?: Simulation) => !!s && (s.club !== rec.club || s.aimOffset !== rec.aimOffset);
  const name = (s: Simulation, cap: boolean) => {
    const t = s.club === rec.club ? `aiming ${aimWords(s.aimOffset)}` : `${lower(s.club)} ${aimWords(s.aimOffset)}`;
    return cap ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  };
  if (differs(attack)) {
    const d = rec.expected - attack!.expected; // + means attack is better on average
    const miss = worstMiss(attack!);
    lines.push(d > 0.04
      ? `${name(attack!, true)} gains ${strokes(d)}${miss ? ` but brings ${miss} in` : ""}.`
      : d > -0.05
        ? `${name(attack!, true)} averages the same${miss ? ` with more risk (${miss})` : ""}.`
        : `${name(attack!, true)} costs ${strokes(-d)}${miss ? ` (${miss})` : ""}.`);
  } else if (differs(safe)) {
    const d = safe!.expected - rec.expected;
    lines.push(d < 0.05 ? `The safe play, ${name(safe!, false)}, averages the same.` : `The safe play, ${name(safe!, false)}, gives up ${strokes(d)}.`);
  }

  // The player picked something else: say what it does differently, unless a line above already did.
  const same = (a: Simulation, b?: Simulation) => !!b && a.club === b.club && Math.abs(a.aimOffset - b.aimOffset) < 5;
  if (current && !same(current, rec) && !same(current, attack) && !same(current, safe)) {
    const d = current.expected - rec.expected;
    const miss = worstMiss(current);
    const what = current.club === rec.club ? `Your aim (${aimWords(current.aimOffset)})` : `Your ${lower(current.club)}`;
    lines.push(Math.abs(d) < 0.05
      ? `${what} plays about the same${miss ? `; ${miss}` : ""}.`
      : `${what} ${d > 0 ? "costs" : "saves"} ${strokes(d)} against that${miss ? `; ${miss}` : ""}.`);
  }
  // Course memory goes right after the hazard line, on the tee shot, when there is history.
  const remembered = historyLine(history);
  if (remembered) lines.splice(Math.min(1, lines.length), 0, remembered);
  // The wind comes first: it is why the aim is where it is.
  const w = env ? windLine(env, from, rec) : null;
  if (w) lines.unshift(w);
  return { headline, lines: lines.slice(0, 4) };
}
