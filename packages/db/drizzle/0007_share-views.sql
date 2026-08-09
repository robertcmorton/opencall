CREATE TABLE IF NOT EXISTS "share_views" (
	"id" text PRIMARY KEY NOT NULL,
	"share_token_id" text NOT NULL,
	"name" text NOT NULL,
	"device_id" text NOT NULL,
	"browser" text,
	"os" text,
	"screen" text,
	"ip" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_views" ADD CONSTRAINT "share_views_share_token_id_share_tokens_id_fk" FOREIGN KEY ("share_token_id") REFERENCES "public"."share_tokens"("id") ON DELETE cascade ON UPDATE no action;