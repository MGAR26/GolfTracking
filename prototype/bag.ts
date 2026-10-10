/**
 * My Bag: what a player says about each club, blended with what their tracked shots show.
 * The result is a dispersion model in shot-relative coordinates (lateral = right of the aim
 * line, long = past the aim), good enough to draw an ellipse on the hole and to simulate from.
 */
import { dist, type Pt } from "./holeGeometry";
import { CLUBS, DEFAULT_CARRY, missFromAim, type Club, type Shot } from "./shots";

export type MissBias = "straight" | "left" | "right" | "two-way";
export type MissWidth = "narrow" | "normal" | "wide";
export interface ClubProfile { carry: number; /** Yards it runs after landing on fairway, normal turf. */ roll?: number; miss: MissBias; width: MissWidth; /** Measured average miss, yards right (+) or left (-) of the aim; set when the player accepts a bag tip. */ lateralBias?: number }
/** Typical rollout on fairway, normal turf: long clubs run, wedges stop. */
export const DEFAULT_ROLL: Record<Club, number> = { Dr: 20, "3W": 15, "5W": 12, Hy: 10, "4i": 8, "5i": 7, "6i": 5, "7i": 4, "8i": 3, "9i": 2, PW: 2, GW: 1, SW: 1, LW: 0 };
export const rollOf = (club: Club, profile?: ClubProfile) => profile?.roll ?? DEFAULT_ROLL[club];
/** Full swings before a measured distance starts to move a carry the player typed in. */
export const FULL_SHOTS_TO_NUDGE = 5;
export type Bag = Partial<Record<Club, ClubProfile>>;

export interface DispersionModel {
  club: Club;
  /** Mean carry in yards along the aim line. */
  carry: number;
  /** Mean miss relative to the aim: lateral (+ right) and long (+ past). */
  center: { lateral: number; long: number };
  sdLateral: number;
  sdLong: number;
  /** Rollout after landing on fairway, normal turf. */
  roll: number;
  /** Where the carry number comes from. */
  distanceSource: "entered" | "entered+shots" | "shots" | "estimate";
  /** Full swings (not partial shots) that measured the distance. */
  fullShots: number;
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
function priorModel(club: Club, profile: ClubProfile, handicapIndex: number) {
  const skill = 1 + Math.max(0, handicapIndex - 5) * 0.03; // a 20 handicap scatters ~45% wider than a 5
  const sdLateral = profile.carry * WIDTH_PCT[profile.width] * skill * (profile.miss === "two-way" ? 1.3 : 1);
  const sdLong = profile.carry * 0.055 * skill;
  const bias = profile.miss === "left" ? -0.6 : profile.miss === "right" ? 0.6 : 0;
  const lateral = profile.lateralBias ?? bias * sdLateral;
  return { club, carry: profile.carry, roll: rollOf(club, profile), center: { lateral, long: 0 }, sdLateral, sdLong };
}

/**
 * A full swing tells us how far the club goes; a three-quarter wedge into a green or a punch-out
 * does not. With an aim point, the shot counts if it was aimed at least the club's usual
 * distance (less 15); without one, if it went at least 80% of it.
 */
export function isFullSwing(s: Shot, usualTotal: number): boolean {
  if (s.club === "putt" || s.club === "chip") return false;
  return s.aim ? dist(s.from, s.aim) >= usualTotal - 15 : s.distance >= usualTotal * 0.8;
}

/**
 * Profile (what the player entered, or a handicap-based estimate) blended with their shots.
 * Distance: a carry the player typed in is shown exactly as typed until FULL_SHOTS_TO_NUDGE full
 * swings exist, then measured carries (finish distance minus the club's roll) nudge it gently.
 * An estimated carry gives way to measured full swings quickly. Partial shots never count.
 * Miss pattern: every aimed shot with the club feeds the left/right and long/short spread.
 */
export function dispersionModel(club: Club, bag: Bag, handicapIndex: number, shots: Shot[], playerId: string): DispersionModel {
  const entered = bag[club];
  const profile = entered ?? defaultProfile(club, handicapIndex);
  const prior = priorModel(club, profile, handicapIndex);
  const mine = shots.filter((s) => s.playerId === playerId && s.club === club);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // distance from full swings only
  const full = mine.filter((s) => isFullSwing(s, prior.carry + prior.roll));
  const nFull = full.length;
  const wDist = entered ? (nFull >= FULL_SHOTS_TO_NUDGE ? nFull / (nFull + 10) : 0) : nFull / (nFull + PRIOR_SHOTS);
  const carry = wDist > 0 ? (1 - wDist) * prior.carry + wDist * mean(full.map((s) => s.distance - prior.roll)) : prior.carry;
  const distanceSource: DispersionModel["distanceSource"] = entered ? (wDist > 0 ? "entered+shots" : "entered") : nFull ? "shots" : "estimate";
  // miss pattern from aimed shots
  const misses = mine.map((s) => ({ s, m: missFromAim(s) })).filter((x): x is { s: Shot; m: { lateral: number; long: number } } => x.m !== null);
  const n = misses.length;
  const base = { club, carry, roll: prior.roll, distanceSource, fullShots: nFull };
  if (n === 0) return { ...base, center: prior.center, sdLateral: prior.sdLateral, sdLong: prior.sdLong, samples: 0, confidence: "low", source: "profile" };
  // trim the worst outlier once there are enough shots so one shank doesn't own the ellipse
  const kept = n >= 5 ? misses.sort((a, b) => Math.hypot(a.m.lateral, a.m.long) - Math.hypot(b.m.lateral, b.m.long)).slice(0, n - 1) : misses;
  const sd = (xs: number[], mu: number) => Math.sqrt(xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / Math.max(1, xs.length - 1));
  const lat = kept.map((x) => x.m.lateral), lng = kept.map((x) => x.m.long);
  const w = n / (n + PRIOR_SHOTS);
  const mLat = mean(lat), mLng = mean(lng);
  const sdL = kept.length >= 3 ? sd(lat, mLat) : prior.sdLateral, sdG = kept.length >= 3 ? sd(lng, mLng) : prior.sdLong;
  return {
    ...base,
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
/** Where a full swing finishes on fairway, normal turf: carry plus roll. */
export const totalOf = (m: DispersionModel) => m.carry + m.roll;
/**
 * How far along the aim line the shot is meant to FINISH. Until the app has enough of the
 * player's own aimed shots with this club, an explicit aim point is taken at its word (the
 * player knows their game better than a default table); once it knows them, the club's
 * carry + roll caps it. With no aim point (aiming at the flag) the club's distance applies.
 */
export function reachAlong(model: DispersionModel, aimDistance: number, followAim: boolean): number {
  return followAim && model.samples < TRUSTED_DISTANCE_SHOTS ? aimDistance : Math.min(aimDistance, totalOf(model));
}
/** Roll planned into a shot meant to finish `finish` yards out: full roll on a full swing, less on a shorter one. */
export function plannedRoll(model: DispersionModel, finish: number): number {
  return model.roll * Math.min(1, finish / Math.max(1, totalOf(model)));
}
/** Where the ball comes down for a shot meant to finish `finish` yards out. */
export const landingAlong = (model: DispersionModel, finish: number) => Math.max(0, finish - plannedRoll(model, finish));

/** Radius multiplier so the ellipse holds `p` of shots (2-D normal). */
export const ellipseScale = (p: number) => Math.sqrt(-2 * Math.log(1 - p));

/** Ellipse outline in hole coordinates for a shot from `from` aimed at `target` (the model is in aim-line coordinates). */
export function dispersionOutline(model: DispersionModel, from: Pt, target: Pt, p = 0.8, steps = 40, followAim = false): Pt[] {
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const k = ellipseScale(p);
  const cLong = reachAlong(model, len, followAim) + model.center.long, cLat = model.center.lateral; // centred where it finishes
  const out: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const a = cLong + Math.cos(t) * model.sdLong * k, b = cLat + Math.sin(t) * model.sdLateral * k;
    out.push({ u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b });
  }
  return out;
}

/** Where the model expects the ball to come down (before any roll). */
export function expectedLanding(model: DispersionModel, from: Pt, target: Pt, followAim = false): Pt {
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const a = landingAlong(model, reachAlong(model, len, followAim)) + model.center.long, b = model.center.lateral;
  return { u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b };
}
/** Where the model expects the ball to finish after its planned roll (flat fairway, normal turf). */
export function expectedFinish(model: DispersionModel, from: Pt, target: Pt, followAim = false): Pt {
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const a = reachAlong(model, len, followAim) + model.center.long, b = model.center.lateral;
  return { u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b };
}

/** One sampled LANDING spot from the model (deterministic for a given seed); roll it out with flight.finishShot. */
export function sampleShot(model: DispersionModel, from: Pt, target: Pt, seed: number, followAim = false): Pt {
  const rnd = (k: number) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const gauss = (k: number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd(k)))) * Math.cos(2 * Math.PI * rnd(k + 1));
  const len = Math.hypot(target.u - from.u, target.v - from.v) || 1;
  const f = { u: (target.u - from.u) / len, v: (target.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const a = landingAlong(model, reachAlong(model, len, followAim)) + model.center.long + gauss(1) * model.sdLong;
  const b = model.center.lateral + gauss(3) * model.sdLateral;
  return { u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b };
}

export const CLUB_LIST = CLUBS;

/* ---------- bag tips: what the tracked shots say that the bag doesn't ---------- */
/** Aimed shots with a club before the app suggests changing the bag. */
export const TIP_AFTER_SHOTS = 8;
export interface BagTip {
  club: Club;
  /** Aimed shots the tip is based on. */
  shots: number;
  /** Average miss right (+) / left (-) of the aim, when it is a steady pattern the bag doesn't know. */
  lateral: number | null;
  /** Measured carry minus the carry in the bag (full swings: finish minus roll), when 5+ yards off. */
  long: number | null;
  /** Measured carry from full swings, when there are enough. */
  measuredCarry: number | null;
  /** What tapping "Update my bag" changes. */
  patch: Partial<ClubProfile>;
}
/**
 * Compare the player's aimed shots with what their bag says. A tip appears once a club has
 * TIP_AFTER_SHOTS aimed shots and either a steady side miss (6+ yards on average, at least 60% of
 * shots on that side) the bag doesn't already account for, or full swings that finish 5+ yards
 * short or long of the aim on average.
 */
export function bagTip(club: Club, bag: Bag, handicapIndex: number, shots: Shot[], playerId: string): BagTip | null {
  const profile = bag[club] ?? defaultProfile(club, handicapIndex);
  const prior = priorModel(club, profile, handicapIndex);
  const aimed = shots.filter((s) => s.playerId === playerId && s.club === club).map((s) => ({ s, m: missFromAim(s) })).filter((x): x is { s: Shot; m: { lateral: number; long: number } } => x.m !== null);
  if (aimed.length < TIP_AFTER_SHOTS) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const lat = mean(aimed.map((x) => x.m.lateral));
  const sameSide = aimed.filter((x) => Math.sign(x.m.lateral) === Math.sign(lat)).length / aimed.length;
  const lateralOff = lat - prior.center.lateral;
  const lateral = Math.abs(lateralOff) >= 6 && sameSide >= 0.6 ? Math.round(lat) : null;
  // distance: every full swing with the club (aimed or not), finish minus roll, against the bag's carry
  const full = shots.filter((s) => s.playerId === playerId && s.club === club && isFullSwing(s, prior.carry + prior.roll));
  const measuredCarry = full.length >= FULL_SHOTS_TO_NUDGE ? Math.round(mean(full.map((s) => s.distance - prior.roll))) : null;
  const long = measuredCarry !== null && Math.abs(measuredCarry - profile.carry) >= 5 ? measuredCarry - profile.carry : null;
  if (lateral === null && long === null) return null;
  const patch: Partial<ClubProfile> = { ...profile };
  if (lateral !== null) { patch.lateralBias = lateral; patch.miss = lateral > 0 ? "right" : "left"; }
  if (long !== null && measuredCarry !== null) patch.carry = Math.max(20, measuredCarry);
  return { club, shots: aimed.length, lateral, long, measuredCarry, patch };
}
