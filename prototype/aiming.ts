/**
 * Target vs aim. The player picks a TARGET: where they want the ball to finish. The app works out
 * where to AIM (the start line) so that, in today's wind, on this ground, with this club's roll and
 * the player's usual miss, the ball comes back to the target. Each shot keeps both, plus where a
 * neutral swing at that aim line would have finished in the conditions; the player's miss is
 * measured from that, so the wind is never learned as a swing fault.
 */
import { dist, type Pt } from "./holeGeometry";
import { landingAlong, plannedRoll, reachAlong, totalOf, type DispersionModel } from "./bag";
import { applyFlight, type FlightEnv } from "./flight";

const unit = (a: Pt, b: Pt) => { const l = Math.hypot(b.u - a.u, b.v - a.v) || 1; return { u: (b.u - a.u) / l, v: (b.v - a.v) / l }; };

/** Where a swing at `aimPt` finishes in the conditions: no miss, no player tendency, flat roll-out. */
export function neutralFinish(model: DispersionModel, env: FlightEnv, from: Pt, aimPt: Pt, followAim: boolean): Pt {
  const f = unit(from, aimPt);
  const finish = reachAlong(model, dist(from, aimPt), followAim);
  const landStill = { u: from.u + f.u * landingAlong(model, finish), v: from.v + f.v * landingAlong(model, finish) };
  const land = applyFlight(env, from, aimPt, landStill);
  const d = unit(from, land), roll = plannedRoll(model, finish) * (env.rollFactor ?? 1);
  return { u: land.u + d.u * roll, v: land.v + d.v * roll };
}
/** Same, plus the player's usual miss (the model's centre), measured along and across the aim line. */
function typicalFinish(model: DispersionModel, env: FlightEnv, from: Pt, aimPt: Pt, followAim: boolean): Pt {
  const n = neutralFinish(model, env, from, aimPt, followAim);
  const f = unit(from, aimPt), r = { u: -f.v, v: f.u };
  return { u: n.u + f.u * model.center.long + r.u * model.center.lateral, v: n.v + f.v * model.center.long + r.v * model.center.lateral };
}

export interface AimSolution {
  /** Where to start it: the point to aim at. */
  aimLine: Pt;
  /** Where a neutral swing at the aim line finishes in the conditions (the reference for the player's miss). */
  expected: Pt;
  /** Aim line offset from the straight line to the target, yards right (+) or left (-). */
  offset: number;
}
/** Aim line that brings the club's typical shot back to `target` (a few fixed-point steps). */
export function solveAim(model: DispersionModel, env: FlightEnv, from: Pt, target: Pt, followAim = true): AimSolution {
  let a = { ...target };
  for (let i = 0; i < 5; i++) {
    const t = typicalFinish(model, env, from, a, followAim);
    a = { u: a.u + (target.u - t.u), v: a.v + (target.v - t.v) };
  }
  const f = unit(from, target), r = { u: -f.v, v: f.u };
  const offset = Math.round((a.u - from.u) * r.u + (a.v - from.v) * r.v);
  return { aimLine: a, expected: neutralFinish(model, env, from, a, followAim), offset };
}

/**
 * The club for a target: whichever full swing, in today's wind and on this ground, finishes
 * closest to the distance needed. Chip inside 30 yards.
 */
export function clubForTarget<C extends string>(models: { club: C; model: DispersionModel }[], env: FlightEnv, from: Pt, target: Pt): C | "chip" {
  const need = dist(from, target);
  if (need < 30) return "chip";
  const f = unit(from, target);
  const far = { u: from.u + f.u * 1000, v: from.v + f.v * 1000 };
  let best = models[0].club, bestDiff = Infinity;
  for (const { club, model } of models) {
    const fin = neutralFinish(model, env, from, far, false);
    const along = (fin.u - from.u) * f.u + (fin.v - from.v) * f.v;
    const diff = Math.abs(along - need) + (along < need - 10 ? 2 : 0); // tie-break toward getting there
    if (diff < bestDiff) { best = club; bestDiff = diff; }
  }
  return best;
}
export { totalOf };
