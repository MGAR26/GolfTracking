export type TripRole = "OWNER" | "ORGANIZER" | "SCORER" | "PLAYER" | "GUEST";
export type ScoringMode = "GROUP_SCORER" | "INDIVIDUAL" | "HYBRID";

export interface ScorePermissionInput {
  actorId: string;
  actorRole: TripRole | null;
  scoringMode: ScoringMode;
  /** Player designated as scorer for the target player's group (round_players.scorer_player_id). */
  scorerPlayerId: string | null;
  targetPlayerId: string;
  roundStatus: string;
}

export function isOrganizer(role: TripRole | null): boolean {
  return role === "OWNER" || role === "ORGANIZER";
}

/** Who may edit whose score under each scoring mode. */
export function canEditScore(p: ScorePermissionInput): boolean {
  if (p.roundStatus !== "LIVE") return false;
  if (isOrganizer(p.actorRole)) return true;
  const isSelf = p.actorId === p.targetPlayerId;
  const isScorer = p.scorerPlayerId === p.actorId;
  switch (p.scoringMode) {
    case "GROUP_SCORER":
      return isScorer;
    case "INDIVIDUAL":
      return isSelf;
    case "HYBRID":
      return isSelf || isScorer;
  }
}
