CREATE TABLE "score_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"player_id" text NOT NULL,
	"hole_number" integer NOT NULL,
	"reported_by" text NOT NULL,
	"mine_json" jsonb NOT NULL,
	"theirs_json" jsonb NOT NULL,
	"theirs_updated_by" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolved_by" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "score_conflicts" ADD CONSTRAINT "score_conflicts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_conflicts" ADD CONSTRAINT "score_conflicts_player_id_player_profiles_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_conflicts_round_idx" ON "score_conflicts" USING btree ("round_id","status");