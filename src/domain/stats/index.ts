import type { HoleEntry, HoleInfo, PlayerId } from "../types";

export interface RoundStats {
  playerId: PlayerId;
  holesEntered: number;
  /** null when no eligible hole has fairway data */
  fairwayPct: number | null;
  fairwaysHit: number;
  fairwayOpportunities: number;
  girPct: number | null;
  girs: number;
  girOpportunities: number;
  putts: number | null;
  puttsPerGir: number | null;
  penaltyStrokes: number;
  obStrokes: number;
  scramblingPct: number | null;
  sandSavePct: number | null;
  birdiesOrBetter: number;
  pars: number;
  bogeys: number;
  doublesOrWorse: number;
  par3Avg: number | null;
  par4Avg: number | null;
  par5Avg: number | null;
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const avg = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100);

/**
 * Stats only count holes where the relevant datum was entered. Missing data stays
 * unknown (null / excluded from the denominator) rather than counting as a miss.
 */
export function computeRoundStats(playerId: PlayerId, holes: HoleInfo[], entries: HoleEntry[]): RoundStats {
  const holeMap = new Map(holes.map((h) => [h.holeNumber, h]));
  const mine = entries.filter((e) => e.playerId === playerId && holeMap.has(e.holeNumber));

  let fairwaysHit = 0, fairwayOpps = 0, girs = 0, girOpps = 0;
  let puttsTotal = 0, puttsEntered = 0, puttsOnGir = 0, girWithPutts = 0;
  let penalties = 0, ob = 0;
  let upDownAttempts = 0, upDowns = 0, sandAttempts = 0, sandSaves = 0;
  let birdies = 0, pars = 0, bogeys = 0, doubles = 0, scored = 0;
  const byPar: Record<number, number[]> = { 3: [], 4: [], 5: [] };

  for (const e of mine) {
    const h = holeMap.get(e.holeNumber)!;
    if (h.par >= 4 && e.fairwayResult !== null) {
      fairwayOpps++;
      if (e.fairwayResult === "HIT") fairwaysHit++;
    }
    if (e.gir !== null) {
      girOpps++;
      if (e.gir) girs++;
    }
    if (e.putts !== null) {
      puttsEntered++;
      puttsTotal += e.putts;
      if (e.gir === true) {
        girWithPutts++;
        puttsOnGir += e.putts;
      }
    }
    penalties += e.penaltyStrokes;
    ob += e.obStrokes;
    if (e.upDownAttempt === true) {
      upDownAttempts++;
      if (e.upDown === true) upDowns++;
    }
    if (e.sandAttempt === true) {
      sandAttempts++;
      if (e.sandSave === true) sandSaves++;
    }
    if (e.grossScore !== null) {
      scored++;
      const toPar = e.grossScore - h.par;
      if (toPar <= -1) birdies++;
      else if (toPar === 0) pars++;
      else if (toPar === 1) bogeys++;
      else doubles++;
      if (byPar[h.par]) byPar[h.par].push(e.grossScore);
    }
  }

  return {
    playerId,
    holesEntered: scored,
    fairwayPct: pct(fairwaysHit, fairwayOpps),
    fairwaysHit,
    fairwayOpportunities: fairwayOpps,
    girPct: pct(girs, girOpps),
    girs,
    girOpportunities: girOpps,
    putts: puttsEntered === 0 ? null : puttsTotal,
    puttsPerGir: girWithPutts === 0 ? null : Math.round((puttsOnGir / girWithPutts) * 100) / 100,
    penaltyStrokes: penalties,
    obStrokes: ob,
    scramblingPct: pct(upDowns, upDownAttempts),
    sandSavePct: pct(sandSaves, sandAttempts),
    birdiesOrBetter: birdies,
    pars,
    bogeys,
    doublesOrWorse: doubles,
    par3Avg: avg(byPar[3]),
    par4Avg: avg(byPar[4]),
    par5Avg: avg(byPar[5]),
  };
}
