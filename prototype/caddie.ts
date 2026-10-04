/**
 * Caddie wording: two or three plain sentences built from the strategy simulation, the hazards
 * ahead and the club the player has picked. Rule-based so it works offline and costs nothing;
 * the real app can hand the same facts to a language model later for tone, never for numbers.
 */
import { dist, type HazardDistance, type Pt } from "./holeGeometry";
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

export function caddieAdvice({ plan, current, hazards, from, remaining }: { plan: Strategy; current: Simulation | null; hazards: HazardDistance[]; from: Pt; remaining: number }): CaddieAdvice {
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
  return { headline, lines: lines.slice(0, 3) };
}
