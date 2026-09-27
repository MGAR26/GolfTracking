import { boolean, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

export const playerProfiles = pgTable("player_profiles", {
  id: id(),
  userId: text("user_id").references(() => users.id),
  guestName: text("guest_name"),
  displayName: text("display_name").notNull(),
  handicapIndex: real("handicap_index").notNull().default(0),
  handicapUpdatedAt: timestamp("handicap_updated_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const trips = pgTable("trips", {
  id: id(),
  ownerId: text("owner_id").references(() => users.id),
  name: text("name").notNull(),
  destination: text("destination"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | COMPLETED | ARCHIVED
  settingsJson: jsonb("settings_json").notNull().default({}),
  createdAt: createdAt(),
});

export const tripMembers = pgTable(
  "trip_members",
  {
    tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
    playerProfileId: text("player_profile_id").notNull().references(() => playerProfiles.id),
    role: text("role").notNull().default("PLAYER"), // OWNER | ORGANIZER | SCORER | PLAYER | GUEST
    active: boolean("active").notNull().default(true),
    orderIndex: integer("order_index").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.playerProfileId] })],
);

export const tripDays = pgTable("trip_days", {
  id: id(),
  tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  label: text("label"),
});

export const courses = pgTable("courses", {
  id: id(),
  providerKey: text("provider_key"),
  providerCourseId: text("provider_course_id"),
  name: text("name").notNull(),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  createdAt: createdAt(),
});

export const teeSets = pgTable("tee_sets", {
  id: id(),
  courseId: text("course_id").notNull().references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  genderCategory: text("gender_category").notNull().default("ANY"),
  par: integer("par").notNull(),
  courseRating: real("course_rating").notNull(),
  slopeRating: integer("slope_rating").notNull(),
  yardage: integer("yardage"),
});

export const holes = pgTable(
  "holes",
  {
    id: id(),
    teeSetId: text("tee_set_id").notNull().references(() => teeSets.id, { onDelete: "cascade" }),
    holeNumber: integer("hole_number").notNull(),
    par: integer("par").notNull(),
    yardage: integer("yardage"),
    strokeIndex: integer("stroke_index").notNull(),
  },
  (t) => [uniqueIndex("holes_tee_set_hole_idx").on(t.teeSetId, t.holeNumber)],
);

export const rounds = pgTable("rounds", {
  id: id(),
  tripId: text("trip_id").references(() => trips.id, { onDelete: "set null" }),
  tripDayId: text("trip_day_id").references(() => tripDays.id, { onDelete: "set null" }),
  courseId: text("course_id").notNull().references(() => courses.id),
  teeSetId: text("tee_set_id").notNull().references(() => teeSets.id),
  name: text("name"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  countsTowardTrip: boolean("counts_toward_trip").notNull().default(true),
  scoringMode: text("scoring_mode").notNull().default("HYBRID"), // GROUP_SCORER | INDIVIDUAL | HYBRID
  status: text("status").notNull().default("SETUP"), // SETUP | LIVE | FINISHED | LOCKED
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const roundPlayers = pgTable(
  "round_players",
  {
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => playerProfiles.id),
    teeSetId: text("tee_set_id").notNull().references(() => teeSets.id),
    handicapIndexSnapshot: real("handicap_index_snapshot").notNull(),
    courseHandicapRaw: real("course_handicap_raw").notNull(),
    courseHandicap: integer("course_handicap").notNull(),
    /** Playing handicap under the round's default (100%) allowance. Games may derive their own. */
    playingHandicap: integer("playing_handicap").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    scorerPlayerId: text("scorer_player_id"),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.playerId] })],
);

export const holeScores = pgTable(
  "hole_scores",
  {
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => playerProfiles.id),
    holeNumber: integer("hole_number").notNull(),
    grossScore: integer("gross_score"),
    putts: integer("putts"),
    fairwayResult: text("fairway_result"), // HIT | LEFT | RIGHT | SHORT | LONG
    gir: boolean("gir"),
    penaltyStrokes: integer("penalty_strokes").notNull().default(0),
    obStrokes: integer("ob_strokes").notNull().default(0),
    sandAttempt: boolean("sand_attempt"),
    sandSave: boolean("sand_save"),
    upDownAttempt: boolean("up_down_attempt"),
    upDown: boolean("up_down"),
    driveDistance: integer("drive_distance"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
    /** Client-generated idempotency key for offline queue replay. */
    clientEventId: text("client_event_id"),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.playerId, t.holeNumber] })],
);

export const games = pgTable("games", {
  id: id(),
  roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  rulesJson: jsonb("rules_json").notNull().default({}),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | FINALIZED | VOID
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: createdAt(),
});

export const gameTeams = pgTable("game_teams", {
  id: id(),
  gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const gameParticipants = pgTable(
  "game_participants",
  {
    gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => playerProfiles.id),
    teamId: text("team_id").references(() => gameTeams.id, { onDelete: "set null" }),
    handicapAllowance: integer("handicap_allowance").notNull().default(100),
    orderIndex: integer("order_index").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

export const gameResults = pgTable("game_results", {
  id: id(),
  gameId: text("game_id").notNull().references(() => games.id, { onDelete: "cascade" }),
  scopeType: text("scope_type").notNull().default("ROUND"),
  scopeKey: text("scope_key").notNull().default("FINAL"),
  resultJson: jsonb("result_json").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const tripCompetitions = pgTable("trip_competitions", {
  id: id(),
  tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // TOTAL_GROSS | TOTAL_NET | PLACEMENT_POINTS | SKINS_WON | BIRDIES | MONEY
  name: text("name").notNull(),
  rulesJson: jsonb("rules_json").notNull().default({}),
  active: boolean("active").notNull().default(true),
  orderIndex: integer("order_index").notNull().default(0),
});

export const sideBets = pgTable("side_bets", {
  id: id(),
  roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
  holeNumber: integer("hole_number"),
  creatorId: text("creator_id").notNull().references(() => playerProfiles.id),
  type: text("type").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  basis: text("basis").notNull().default("GROSS"),
  holeNumbersJson: jsonb("hole_numbers_json").notNull().default([]),
  settlementMode: text("settlement_mode").notNull().default("EXTRA"), // EXTRA = separate from games
  status: text("status").notNull().default("PROPOSED"),
  createdAt: createdAt(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export const sideBetParticipants = pgTable(
  "side_bet_participants",
  {
    sideBetId: text("side_bet_id").notNull().references(() => sideBets.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => playerProfiles.id),
    side: text("side").notNull(), // A | B
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.sideBetId, t.playerId] })],
);

export const sideBetResolutions = pgTable("side_bet_resolutions", {
  id: id(),
  sideBetId: text("side_bet_id").notNull().references(() => sideBets.id, { onDelete: "cascade" }),
  winnerSide: text("winner_side"), // A | B | null for tie/void
  winnerPlayerId: text("winner_player_id"),
  resultJson: jsonb("result_json").notNull().default({}),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    tripId: text("trip_id").references(() => trips.id, { onDelete: "set null" }),
    roundId: text("round_id").references(() => rounds.id, { onDelete: "set null" }),
    sourceType: text("source_type").notNull(), // GAME | SIDE_BET | ADJUSTMENT | REVERSAL
    sourceId: text("source_id").notNull(),
    fromPlayerId: text("from_player_id").notNull().references(() => playerProfiles.id),
    toPlayerId: text("to_player_id").notNull().references(() => playerProfiles.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("POSTED"), // PENDING | POSTED | REVERSED
    memo: text("memo").notNull().default(""),
    reversesEntryId: text("reverses_entry_id"),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_trip_idx").on(t.tripId), index("ledger_round_idx").on(t.roundId)],
);

export const auditEvents = pgTable("audit_events", {
  id: id(),
  actorId: text("actor_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: createdAt(),
});

/** A reported edit conflict on one player's hole, for organizer reconciliation. */
export const scoreConflicts = pgTable(
  "score_conflicts",
  {
    id: id(),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => playerProfiles.id),
    holeNumber: integer("hole_number").notNull(),
    reportedBy: text("reported_by").notNull(),
    /** What the reporter tried to save. */
    mineJson: jsonb("mine_json").notNull(),
    /** What was on the server at the time (the accepted edit). */
    theirsJson: jsonb("theirs_json").notNull(),
    theirsUpdatedBy: text("theirs_updated_by"),
    status: text("status").notNull().default("OPEN"), // OPEN | RESOLVED | DISMISSED
    resolvedBy: text("resolved_by"),
    resolution: text("resolution"), // MINE | THEIRS | DISMISSED
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("score_conflicts_round_idx").on(t.roundId, t.status)],
);
