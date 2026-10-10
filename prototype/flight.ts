/**
 * What the air and the ground do to a shot, in the hole frame (u up the hole, v to the right).
 * Deliberately simple and explainable, matching the plays-like arithmetic:
 *  - crosswind drifts the ball about 0.55 yards per mph for every 100 yards it flies;
 *  - a headwind takes off 1% of the distance per mph, a tailwind adds 0.5% per mph;
 *  - landing uphill takes off a yard for every 3 feet of rise, downhill adds it back.
 * The strategy simulation, the demo "Mark ball" placement and the dispersion drawing all use it,
 * so the recommended aim leans into the wind on its own.
 */
import { elevationAt, lieAt, type ElevationSample, type HoleShape, type Pt, type Wind } from "./holeGeometry";

export interface FlightEnv {
  /** Wind the ball travels in, mph, as a vector in the hole frame (the direction it blows toward). */
  windU: number;
  windV: number;
  /** Measured ground height along the hole, if the course has it. */
  elevation?: ElevationSample[];
  /** Turf: how much farther than normal the ball runs after landing (soft 0.5, normal 1, firm 1.5). */
  rollFactor?: number;
}
export const ROLL_FACTOR = { soft: 0.5, normal: 1, firm: 1.5 } as const;
export const CALM: FlightEnv = { windU: 0, windV: 0 };

export const DRIFT_PER_MPH_PER_YD = 0.0055;

/** Wind from a compass direction, turned into the hole frame using the hole's tee→green bearing. */
export function flightEnv(wind: Wind, bearingDeg: number, hole?: HoleShape, rollFactor = 1): FlightEnv {
  const toDeg = (wind.fromDeg + 180) % 360;
  const rel = ((toDeg - bearingDeg) * Math.PI) / 180; // clockwise from the hole line: + is to the right
  return { windU: Math.cos(rel) * wind.mph, windV: Math.sin(rel) * wind.mph, elevation: hole?.elevation, rollFactor };
}

/** Head (+ into) and cross (+ blowing to the right) wind for a shot from `from` toward `to`. */
export function windFor(env: FlightEnv, from: Pt, to: Pt): { head: number; cross: number } {
  const len = Math.hypot(to.u - from.u, to.v - from.v) || 1;
  const f = { u: (to.u - from.u) / len, v: (to.v - from.v) / len }, r = { u: -f.v, v: f.u };
  return { head: -(env.windU * f.u + env.windV * f.v), cross: env.windU * r.u + env.windV * r.v };
}

/** Where a still-air landing spot `to` (aimed from `from` toward `aim`) really ends up. */
export function applyFlight(env: FlightEnv, from: Pt, aim: Pt, to: Pt): Pt {
  if (!env.windU && !env.windV && !env.elevation) return to;
  const len = Math.hypot(aim.u - from.u, aim.v - from.v) || 1;
  const f = { u: (aim.u - from.u) / len, v: (aim.v - from.v) / len }, r = { u: -f.v, v: f.u };
  const du = to.u - from.u, dv = to.v - from.v;
  let a = du * f.u + dv * f.v; // distance along the aim line
  let b = du * r.u + dv * r.v; // lateral, + right
  const { head, cross } = windFor(env, from, aim);
  const flight = Math.max(0, a);
  a *= head > 0 ? 1 - 0.01 * head : 1 - 0.005 * head;
  b += cross * DRIFT_PER_MPH_PER_YD * flight;
  if (env.elevation) {
    const rise = elevationAt(env.elevation, from.u + f.u * a) - elevationAt(env.elevation, from.u);
    a -= rise / 3;
  }
  return { u: from.u + f.u * a + r.u * b, v: from.v + f.v * a + r.v * b };
}

type Lie = ReturnType<typeof lieAt>;
/**
 * A shot from landing to rest. The wind and slope move the landing spot (applyFlight), then the
 * ball runs on along its line: full roll on fairway and green, a third in rough, none from sand or
 * water. A ball that lands short of a bunker or water can run into it.
 */
export function finishShot(env: FlightEnv, hole: HoleShape, from: Pt, aim: Pt, landStill: Pt, roll: number): { land: Pt; rest: Pt; lie: Lie; landLie: Lie } {
  const land = applyFlight(env, from, aim, landStill);
  const landLie = lieAt(hole, land);
  const r = roll * (env.rollFactor ?? 1) * (landLie === "rough" ? 0.35 : landLie === "sand" || landLie === "water" ? 0 : 1);
  if (r < 0.5) return { land, rest: land, lie: landLie, landLie };
  const len = Math.hypot(land.u - from.u, land.v - from.v) || 1;
  const d = { u: (land.u - from.u) / len, v: (land.v - from.v) / len };
  const at = (k: number): Pt => ({ u: land.u + d.u * r * k, v: land.v + d.v * r * k });
  if (r >= 6) {
    // check halfway so a bunker or water in the run-out catches it
    const mid = at(0.5), midLie = lieAt(hole, mid);
    if (midLie === "sand" || midLie === "water") return { land, rest: mid, lie: midLie, landLie };
    if (midLie === "rough" && landLie !== "rough") { const slow = at(0.65); return { land, rest: slow, lie: lieAt(hole, slow), landLie }; }
  }
  const rest = at(1);
  return { land, rest, lie: lieAt(hole, rest), landLie };
}
