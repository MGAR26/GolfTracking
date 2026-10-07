/**
 * My Bag: what a player says about each club, blended with what their tracked shots show.
 * The result is a dispersion model in shot-relative coordinates (lateral = right of the aim
 * line, long = past the aim), good enough to draw an ellipse on the hole and to simulate from.
 */
import type { Pt } from "./holeGeometry";
import { CLUBS, DEFAULT_CARRY, missFromAim, type Club, type Shot } from "./shots";

export type MissBias = "straight" | "left" | "right" | "two-way";
export type MissWidth = "narrow" | "normal" | "wide";
export interface ClubProfile { carry: number; miss: MissBias; width: MissWidth }
export type Bag = Partial<Record<Club, ClubProfile>>;

export interface DispersionModel {
  club: Club;
  /** Mean carry in yards along the aim line. */
  carry: number;
  /** Mean miss relative to the aim: lateral (+ right) and long (+ past). */
  center: { lateral: number; long: number };
  sdLateral: number;
  sdLong: number;
  /** Aimed shots that fed the model. */
  samples: number;
  confidence: "low" | "medium" | "high";
  source: "profile" | "blend" | "data";
}

const WIDTH_PCT: Record<MissWidth, number> = { narrow: 0.045, normal: 0.065, wide: 0.095 };
/** Weight of the profile prior against measured shots: after this many aimed shots the data has equal say. */
const PRIOR_SHOTS = 6;

export function defaultProfile(club: Club, handicapIndex: number): ClubProfile {
  return { carry: Math.round(DEFAULT_CARRY[club] * (1 - Math.max(0, handicapIndex - 5) * 0.006)), miss: "straight", width: handicapIndex <= 8 ? "narrow" : handicapIndex <= 18 ? "normal" : "wide" };
}

/** What the profile alone implies, before any measured shots. */
function priorModel(club: Club, profile: ClubProfile, handicapIndex: number): Omit<DispersionModel, "samples" | "confidence" | "source"> {
  const skill = 1 + Math.max(0, handicapIndex - 5) * 0.03; // a 20 handicap scatters ~45% wider than a 5
  const sdLateral = profile.carry * WIDTH_PCT[profile.width] * skill * (profile.miss === "two-way" ? 1.3 : 1);
  const sdLong = profile.carry * 0.055 * skill;
  const bias = profile.miss === "left" ? -0.6 : profile.miss === "right" ? 0.6 : 0;
  return { club, carry: profile.carry, center: { lateral: bias * sdLateral, long: 0 }, sdLateral, sdLong };
}

/** Profile prior blended with the player's aimed shots for that club (robust: trims the single worst miss). */
export function dispersionModel(club: Club, bag: Bag, handicapIndex: number, shots: Shot[], playerId: string): DispersionModel {
  const profile = bag[club] ?? defaultProfile(club, handicapIndex);
  const prior = priorModel(club, profile, handicapIndex);
  const mine = shots.filter((s) => s.playerId === playerId && s.club === club);
  const misses = mine.map((s) => ({ s, m: missFromAim(s) })).filter((x): x is { s: Shot; m: { lateral: number; long: number } } => x.m !== null);
  const n = misses.length;
  if (n === 0) return { ...prior, samples: 0, confidence: "low", source: "profile" };
  // trim the worst outlier once there are enough shots so one shank doesn't own the ellipse
  const kept = n >= 5 ? misses.sort((a, b) => Math.hypot(a.m.lateral, a.m.long) - Math.hypot(b.m.lateral, b.m.long)).slice(0, n - 1) : misses;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[], mu: number) => Math.sqrt(xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / Math.max(1, xs.length - 1));
  const lat = kept.map((x) => x.m.lateral), lng = kept.map((x) => x.m.long);
  const carries = mine.map((s) => s.distance);
  const w = n / (n + PRIOR_SHOTS);
  const mLat = mean(lat), mLng = mean(lng);
  const sdL = kept.length >= 3 ? sd(lat, mLat) : prior.sdLateral, sdG = kept.length >= 3 ? sd(lng, mLng) : prior.sdLong;
  return {
    club,
    carry: (1 - w) * prior.carry + w * mean(carries),
    center: { lateral: (1 - w) * prior.center.lateral + w * mLat, long: (1 - w) * prior.center.long + w * mLng },
    sdLateral: Math.max(2, (1 - w) * prior.sdLateral + w * sdL),
    sdLong: Math.max(2, (1 - w) * prior.sdLong + w * sdG),
    samples: n,
    confidence: n >= 15 ? "high" : n >= 5 ? "medium" : "low",
    source: n >= 15 ? "data" : "blend",
  };
}

/** Aimed shots with a club before its measured distance is trusted over where the player aims. */
export const TRUSTED_DISTANCE_SHOTS = 15;
/**
 * How far along the aim line the shot is centred. Until the app has enough of the player's own
 * aimed shots with this club, an explicit aim point is taken at its word (the player knows their
 * game better than a default table); once it knows them, the club's measured distance caps it.
 * With no aim point (aiming at the flag) the club's normal distance always applies.
 */
export function reachAlong(model: DispersionModel, aimDistance: number, followAim: boolean): number {
  return followAim && model.samples < TRUSTED_DISTANCE_SHOTS ? aimDistance : Math.min(aimDistance, model.carry);
}

/** Radius multiplier so the ellipse holds `p` of shots (2-D normal). */
export const ellipseScale = (p: number) => Math.sqrt(-2 * Math.log(1 - p));

/** Ellipse outline in hole coordinates for a shot from `from` aimed at `target` (the model is in aim-line coordinates). */
export function dispersionOutline(model: DispersionModel, from: Pt, target: Pt, p = 0.8, steps = 40, followAim = false): Pt[] {
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const k = ellipseScale(p);
  const cLong = reachAlong(model, len, followAim) + model.center.long, cLat = model.center.lateral;
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const a = cLong + Math.cos(t) * model.sdLong * k, b = cLat + Math.sin(t) * model.sdLateral * k;
    out.push({ u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b });
  }
  return out;
}

/** Where the model expects the ball to finish. */
export function expectedLanding(model: DispersionModel, from: Pt, target: Pt, followAim = false): Pt {
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const a = reachAlong(model, len, followAim) + model.center.long, b = model.center.lateral;
  return { u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b };
}

/** One sampled shot from the model (deterministic for a given seed). */
export function sampleShot(model: DispersionModel, from: Pt, target: Pt, seed: number, followAim = false): Pt {
  const rnd = (k: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const gauss = (k: number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd(k)))) * Math.cos(2 * Math.PI * rnd(k + 1));
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const a = reachAlong(model, len, followAim) + model.center.long + gauss(1) * model.sdLong;
  const b = model.center.lateral + gauss(3) * model.sdLateral;
  return { u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b };
}

export const CLUB_LIST = CLUBS;
