CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text,
	"provider_course_id" text,
	"name" text NOT NULL,
	"city" text,
	"state" text,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_participants" (
	"game_id" text NOT NULL,
	"player_id" text NOT NULL,
	"team_id" text,
	"handicap_allowance" integer DEFAULT 100 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "game_participants_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "game_results" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"scope_type" text DEFAULT 'ROUND' NOT NULL,
	"scope_key" text DEFAULT 'FINAL' NOT NULL,
	"result_json" jsonb NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"rules_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hole_scores" (
	"round_id" text NOT NULL,
	"player_id" text NOT NULL,
	"hole_number" integer NOT NULL,
	"gross_score" integer,
	"putts" integer,
	"fairway_result" text,
	"gir" boolean,
	"penalty_strokes" integer DEFAULT 0 NOT NULL,
	"ob_strokes" integer DEFAULT 0 NOT NULL,
	"sand_attempt" boolean,
	"sand_save" boolean,
	"up_down_attempt" boolean,
	"up_down" boolean,
	"drive_distance" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"client_event_id" text,
	CONSTRAINT "hole_scores_round_id_player_id_hole_number_pk" PRIMARY KEY("round_id","player_id","hole_number")
);
--> statement-breakpoint
CREATE TABLE "holes" (
	"id" text PRIMARY KEY NOT NULL,
	"tee_set_id" text NOT NULL,
	"hole_number" integer NOT NULL,
	"par" integer NOT NULL,
	"yardage" integer,
	"stroke_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text,
	"round_id" text,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"from_player_id" text NOT NULL,
	"to_player_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"reverses_entry_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"guest_name" text,
	"display_name" text NOT NULL,
	"handicap_index" real DEFAULT 0 NOT NULL,
	"handicap_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_players" (
	"round_id" text NOT NULL,
	"player_id" text NOT NULL,
	"tee_set_id" text NOT NULL,
	"handicap_index_snapshot" real NOT NULL,
	"course_handicap_raw" real NOT NULL,
	"course_handicap" integer NOT NULL,
	"playing_handicap" integer NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"scorer_player_id" text,
	CONSTRAINT "round_players_round_id_player_id_pk" PRIMARY KEY("round_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text,
	"trip_day_id" text,
	"course_id" text NOT NULL,
	"tee_set_id" text NOT NULL,
	"name" text,
	"starts_at" timestamp with time zone,
	"counts_toward_trip" boolean DEFAULT true NOT NULL,
	"scoring_mode" text DEFAULT 'HYBRID' NOT NULL,
	"status" text DEFAULT 'SETUP' NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "side_bet_participants" (
	"side_bet_id" text NOT NULL,
	"player_id" text NOT NULL,
	"side" text NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "side_bet_participants_side_bet_id_player_id_pk" PRIMARY KEY("side_bet_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "side_bet_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"side_bet_id" text NOT NULL,
	"winner_side" text,
	"winner_player_id" text,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "side_bets" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"hole_number" integer,
	"creator_id" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"basis" text DEFAULT 'GROSS' NOT NULL,
	"hole_numbers_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settlement_mode" text DEFAULT 'EXTRA' NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tee_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"name" text NOT NULL,
	"gender_category" text DEFAULT 'ANY' NOT NULL,
	"par" integer NOT NULL,
	"course_rating" real NOT NULL,
	"slope_rating" integer NOT NULL,
	"yardage" integer
);
--> statement-breakpoint
CREATE TABLE "trip_competitions" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"rules_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_days" (
	"id" text PRIMARY KEY NOT NULL,
	"trip_id" text NOT NULL,
	"date" text NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "trip_members" (
	"trip_id" text NOT NULL,
	"player_profile_id" text NOT NULL,
	"role" text DEFAULT 'PLAYER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trip_members_trip_id_player_profile_id_pk" PRIMARY KEY("trip_id","player_profile_id")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"destination" text,
	"start_date" text,
	"end_date" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_player_id_player_profiles_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_participants" ADD CONSTRAINT "game_participants_team_id_game_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."game_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_results" ADD CONSTRAINT "game_results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_teams" ADD CONSTRAINT "game_teams_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hole_scores" ADD CONSTRAINT "hole_scores_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hole_scores" ADD CONSTRAINT "hole_scores_player_id_player_profiles_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holes" ADD CONSTRAINT "holes_tee_set_id_tee_sets_id_fk" FOREIGN KEY ("tee_set_id") REFERENCES "public"."tee_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_from_player_id_player_profiles_id_fk" FOREIGN KEY ("from_player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_to_player_id_player_profiles_id_fk" FOREIGN KEY ("to_player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_players" ADD CONSTRAINT "round_players_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_players" ADD CONSTRAINT "round_players_player_id_player_profiles_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_players" ADD CONSTRAINT "round_players_tee_set_id_tee_sets_id_fk" FOREIGN KEY ("tee_set_id") REFERENCES "public"."tee_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_trip_day_id_trip_days_id_fk" FOREIGN KEY ("trip_day_id") REFERENCES "public"."trip_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_tee_set_id_tee_sets_id_fk" FOREIGN KEY ("tee_set_id") REFERENCES "public"."tee_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_bet_participants" ADD CONSTRAINT "side_bet_participants_side_bet_id_side_bets_id_fk" FOREIGN KEY ("side_bet_id") REFERENCES "public"."side_bets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_bet_participants" ADD CONSTRAINT "side_bet_participants_player_id_player_profiles_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_bet_resolutions" ADD CONSTRAINT "side_bet_resolutions_side_bet_id_side_bets_id_fk" FOREIGN KEY ("side_bet_id") REFERENCES "public"."side_bets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_bets" ADD CONSTRAINT "side_bets_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "side_bets" ADD CONSTRAINT "side_bets_creator_id_player_profiles_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tee_sets" ADD CONSTRAINT "tee_sets_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_competitions" ADD CONSTRAINT "trip_competitions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_days" ADD CONSTRAINT "trip_days_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_members" ADD CONSTRAINT "trip_members_player_profile_id_player_profiles_id_fk" FOREIGN KEY ("player_profile_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holes_tee_set_hole_idx" ON "holes" USING btree ("tee_set_id","hole_number");--> statement-breakpoint
CREATE INDEX "ledger_trip_idx" ON "ledger_entries" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "ledger_round_idx" ON "ledger_entries" USING btree ("round_id");