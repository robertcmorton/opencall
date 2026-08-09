CREATE TABLE IF NOT EXISTS "custom_event_types" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"full_time" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"after_extra" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_label" text,
	"result_due_phrases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blurb" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_event_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "sport" text;--> statement-breakpoint
-- Every sheet that already exists keeps the type it was being run with. The
-- setting used to live on the event, so without this the move would silently
-- clear it on every rundown in the installation.
UPDATE "rundowns" SET "sport" = "events"."sport"
  FROM "events"
  WHERE "rundowns"."event_id" = "events"."id"
    AND "rundowns"."sport" IS NULL
    AND "events"."sport" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_event_types" ADD CONSTRAINT "custom_event_types_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_event_types" ADD CONSTRAINT "custom_event_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
