/**
 * Strategy card: drop simulated shots from the player's dispersion onto the real hole, read the
 * outcome of each, and rank club + aim choices by expected strokes to hole out.
 */
import { expectedStrokes } from "../src/domain/strategy/expectedStrokes";
import { dist, lieAt, type HoleShape, type Pt } from "./holeGeometry";
import { sampleShot, type DispersionModel } from "./bag";
import { applyFlight, CALM, DRIFT_PER_MPH_PER_YD, windFor, type FlightEnv } from "./flight";
import { CLUBS, type Club } from "./shots";

export type Outcome = "fairway" | "rough" | "sand" | "water" | "green";
export interface Candidate { club: Club; aim: Pt; aimOffset: number }
export interface Simulation {
  club: Club;
  aim: Pt;
  aimOffset: number;
  samples: number;
  odds: Record<Outcome, number>;
  /** Expected strokes to hole out including this shot. */
  expected: number;
  /** Spread of the strokes-from-landing: 10th and 90th percentiles. */
  p10: number;
  p90: number;
  penaltyProb: number;
  /** Mean yards left to the flag (0 when on the green counts its putting distance). */
  leave: number;
}
export type PlayKind = "safe" | "balanced" | "attack";
export interface Play { kind: PlayKind; sim: Simulation }
export interface Strategy { candidates: Simulation[]; plays: Play[]; recommended: Simulation; risk: number }

/** Utility used to rank: lower is better. `risk` runs −1 (safe) … 0 (balanced) … +1 (attack). */
export function utility(s: Simulation, risk: number): number {
  const safe = Math.max(0, -risk), bold = Math.max(0, risk);
  return s.expected + safe * (0.6 * (s.p90 - s.expected) + 1.0 * s.penaltyProb) - bold * 0.35 * (s.expected - s.p10);
}

/** One club at one aim, `n` shots. */
export function simulate(model: DispersionModel, from: Pt, aim: Pt, flag: Pt, hole: HoleShape, handicapIndex: number, n = 600, aimOffset = 0, env: FlightEnv = CALM, followAim = false): Simulation {
  const counts: Record<Outcome, number> = { fairway: 0, rough: 0, sand: 0, water: 0, green: 0 };
  const next: number[] = [];
  let leaveSum = 0;
  for (let i = 0; i < n; i++) {
    const to = applyFlight(env, from, aim, sampleShot(model, from, aim, i * 7919 + Math.round(aim.v * 13) + model.club.length, followAim));
    const lie = lieAt(hole, to);
    const outcome: Outcome = lie === "tee" ? "fairway" : lie;
    counts[outcome]++;
    const d = dist(to, flag);
    leaveSum += d;
    next.push(expectedStrokes({ distanceYards: d, lie: lie === "tee" ? "fairway" : lie, handicapIndex }));
  }
  next.sort((a, b) => a - b);
  const mean = next.reduce((a, b) => a + b, 0) / n;
  return {
    club: model.club, aim, aimOffset, samples: n,
    odds: Object.fromEntries((Object.keys(counts) as Outcome[]).map((k) => [k, counts[k] / n])) as Record<Outcome, number>,
    expected: 1 + mean,
    p10: 1 + next[Math.floor(n * 0.1)],
    p90: 1 + next[Math.floor(n * 0.9)],
    penaltyProb: counts.water / n,
    leave: leaveSum / n,
  };
}

/** Aim `offset` yards right of the straight line at the club's carry (or at the flag if it reaches). */
export function aimFor(from: Pt, flag: Pt, carry: number, offset: number): Pt {
  const len = dist(from, flag) || 1;
  const f = { u: (flag.u - from.u) / len, v: (flag.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const along = Math.min(len, carry);
  return { u: from.u + f.u * along + r.u * offset, v: from.v + f.v * along + r.v * offset };
}

/** Every sensible club and aim from here, ranked; the three plays and the slider's pick. */
export function recommend(models: (club: Club) => DispersionModel, from: Pt, flag: Pt, hole: HoleShape, handicapIndex: number, risk = 0, samples = 500, env: FlightEnv = CALM): Strategy {
  const remaining = dist(from, flag);
  const offsets = [-30, -20, -10, 0, 10, 20, 30];
  const candidates: Simulation[] = [];
  for (const club of CLUBS) {
    const m = models(club);
    if (m.carry > remaining + 25) continue; // would fly the green
    if (m.carry < remaining * 0.35 && remaining > 60) continue; // pointless lay-up
    // Centre the aim fan on the wind correction for this club so the into-the-wind aim is tried exactly.
    const drift = windFor(env, from, flag).cross * DRIFT_PER_MPH_PER_YD * Math.min(remaining, m.carry);
    const offs = [...new Set(offsets.map((o) => Math.round(o - drift)))];
    for (const off of offs) candidates.push(simulate(m, from, aimFor(from, flag, m.carry, off), flag, hole, handicapIndex, samples, off, env));
  }
  if (candidates.length === 0) {
    const m = models("PW");
    candidates.push(simulate(m, from, aimFor(from, flag, m.carry, 0), flag, hole, handicapIndex, samples, 0, env));
  }
  const best = (r: number) => candidates.reduce((a, b) => (utility(b, r) < utility(a, r) ? b : a));
  // Three distinct plays: best expected score; the lowest-downside play near it; the highest-upside play near it.
  const balanced = best(0);
  const near = candidates.filter((c) => c.expected <= balanced.expected + 0.25 && c !== balanced);
  const same = (a: Simulation, b: Simulation) => a.club === b.club && a.aimOffset === b.aimOffset;
  const pickDistinct = (pool: Simulation[], score: (c: Simulation) => number, taken: Simulation[]) =>
    [...pool].sort((a, b) => score(a) - score(b)).find((c) => !taken.some((t) => same(t, c))) ?? balanced;
  const safe = pickDistinct(near, (c) => c.p90 + 2 * c.penaltyProb + c.expected * 0.3, [balanced]);
  const attack = pickDistinct(near, (c) => c.p10 + c.leave * 0.002 + c.expected * 0.3, [balanced, safe]);
  const plays: Play[] = [{ kind: "safe", sim: safe }, { kind: "balanced", sim: balanced }, { kind: "attack", sim: attack }];
  // The slider's pick is whichever of the three the risk-weighted ranking prefers.
  const recommended = plays.reduce((a, b) => (utility(b.sim, risk) < utility(a.sim, risk) ? b : a)).sim;
  return { candidates, plays, recommended, risk };
}

export const describeAim = (off: number) => (Math.abs(off) < 5 ? "aim centre" : `aim ${Math.abs(off)} yd ${off > 0 ? "right" : "left"}`);
