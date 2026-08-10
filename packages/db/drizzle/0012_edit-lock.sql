-- One editor at a time on a run sheet.
--
-- `edit_lock_at` is a HEARTBEAT, not the moment the lock was taken. A lock
-- that had to be released by hand would strand a sheet the instant somebody
-- shut their laptop, and a show that cannot be edited because a producer went
-- home is worse than two people editing. `edit_lock_since` keeps the taken-at
-- moment separately, for the "held since 14:20" line on screen.
--
-- IF NOT EXISTS throughout: these run against installations at every age, and
-- a migration that only works on a fresh database is not a migration.
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "edit_lock_by" text;--> statement-breakpoint
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "edit_lock_user_id" text;--> statement-breakpoint
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "edit_lock_token" text;--> statement-breakpoint
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "edit_lock_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "edit_lock_since" timestamp with time zone;--> statement-breakpoint
-- Who holds it, as the doc channel sees identity: "user:<id>", "company:<id>"
-- or "admin". The user id alone is not enough — company and admin tokens hold
-- locks too and have no user row.
ALTER TABLE "rundowns" ADD COLUMN IF NOT EXISTS "edit_lock_holder_key" text;--> statement-breakpoint
-- Added without a foreign key on purpose: the holder may be a company token or
-- an admin with no user row, and a constraint that only some holders can
-- satisfy would refuse the lock rather than record it.
DO $$ BEGIN
  ALTER TABLE "rundowns" ADD CONSTRAINT "rundowns_edit_lock_user_id_users_id_fk"
    FOREIGN KEY ("edit_lock_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
