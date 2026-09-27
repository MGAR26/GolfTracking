import type { HoleEntry, PlayerId } from "../types";
import type { GameSettlement } from "../games/types";

export type SideBetType =
  | "LONGEST_DRIVE_IN_FAIRWAY"
  | "CLOSEST_TO_PIN"
  | "HOLE_WINNER"
  | "BIRDIE_CHALLENGE"
  | "LOW_SCORE_HOLES"
  | "HEAD_TO_HEAD_MATCH"
  | "PUTTING_CONTEST"
  | "CUSTOM";

export type SideBetStatus = "PROPOSED" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "SETTLED" | "VOID";

/** Terms that are locked once every opposing party has accepted. */
export interface SideBetTerms {
  type: SideBetType;
  description: string;
  amountCents: number;
  holeNumbers: number[];
  basis: "GROSS" | "NET";
}

export interface SideBetParticipant {
  playerId: PlayerId;
  side: "A" | "B";
  acceptedAt: string | null;
}

export interface SideBet {
  id: string;
  roundId: string;
  creatorId: PlayerId;
  terms: SideBetTerms;
  participants: SideBetParticipant[];
  status: SideBetStatus;
}

export const SIDE_BET_PRESETS: { type: SideBetType; label: string; autoResolvable: boolean }[] = [
  { type: "LONGEST_DRIVE_IN_FAIRWAY", label: "Longest drive in fairway", autoResolvable: false },
  { type: "CLOSEST_TO_PIN", label: "Closest to pin", autoResolvable: false },
  { type: "HOLE_WINNER", label: "Hole winner", autoResolvable: true },
  { type: "BIRDIE_CHALLENGE", label: "Birdie challenge", autoResolvable: false },
  { type: "LOW_SCORE_HOLES", label: "Low score over holes", autoResolvable: true },
  { type: "HEAD_TO_HEAD_MATCH", label: "Head-to-head match", autoResolvable: false },
  { type: "PUTTING_CONTEST", label: "Putting contest", autoResolvable: false },
  { type: "CUSTOM", label: "Custom", autoResolvable: false },
];

export function isFullyAccepted(bet: SideBet): boolean {
  // The creator implicitly accepts; every other participant must accept.
  return bet.participants.every((p) => p.playerId === bet.creatorId || p.acceptedAt !== null);
}

export function assertCanAccept(bet: SideBet, playerId: PlayerId): void {
  if (bet.status !== "PROPOSED") throw new Error(`Bet is ${bet.status}, not open for acceptance`);
  const p = bet.participants.find((x) => x.playerId === playerId);
  if (!p) throw new Error("Player is not part of this bet");
  if (p.acceptedAt) throw new Error("Already accepted");
}

export function assertCanSettle(bet: SideBet): void {
  if (bet.status !== "ACCEPTED") throw new Error("Bet must be accepted by all parties before it can settle");
}

/** Material terms are frozen once accepted. Changing them requires cancel + replace. */
export function assertTermsEditable(bet: SideBet): void {
  if (bet.status !== "PROPOSED") throw new Error("Terms are locked after acceptance; cancel and re-propose instead");
}

/**
 * Deterministic auto-resolution for bets that depend only on entered scores.
 * Returns the winner side, "TIE", or null when the required data is missing / bet type is manual.
 */
export function autoResolve(
  bet: SideBet,
  entries: HoleEntry[],
  allocationFor: (playerId: PlayerId) => Record<number, number>,
): "A" | "B" | "TIE" | null {
  if (bet.terms.type !== "HOLE_WINNER" && bet.terms.type !== "LOW_SCORE_HOLES") return null;
  const sideTotal = (side: "A" | "B"): number | null => {
    const players = bet.participants.filter((p) => p.side === side).map((p) => p.playerId);
    let best: number | null = null;
    for (const pid of players) {
      let total = 0;
      for (const hole of bet.terms.holeNumbers) {
        const e = entries.find((x) => x.playerId === pid && x.holeNumber === hole);
        if (!e || e.grossScore === null) return null;
        total += bet.terms.basis === "NET" ? e.grossScore - (allocationFor(pid)[hole] ?? 0) : e.grossScore;
      }
      best = best === null ? total : Math.min(best, total);
    }
    return best;
  };
  const a = sideTotal("A");
  const b = sideTotal("B");
  if (a === null || b === null) return null;
  if (a === b) return "TIE";
  return a < b ? "A" : "B";
}

/** Each losing participant pays each winning participant the bet amount. */
export function settlementsForSideBet(bet: SideBet, winnerSide: "A" | "B", memo: string): GameSettlement[] {
  const winners = bet.participants.filter((p) => p.side === winnerSide).map((p) => p.playerId);
  const losers = bet.participants.filter((p) => p.side !== winnerSide).map((p) => p.playerId);
  const out: GameSettlement[] = [];
  for (const l of losers) for (const w of winners) out.push({ fromPlayerId: l, toPlayerId: w, amountCents: bet.terms.amountCents, memo });
  return out;
}
