CREATE TABLE IF NOT EXISTS "user_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"token" text NOT NULL,
	"team_id" text,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invited_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;