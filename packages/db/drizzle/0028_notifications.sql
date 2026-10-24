CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"user_id" text,
	"rundown_id" text,
	"detail" jsonb,
	"key" text,
	"read_at" timestamp with time zone,
	"read_by" text
);
--> statement-breakpoint
CREATE INDEX "notifications_audience_idx" ON "notifications" USING btree ("audience","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_key_idx" ON "notifications" USING btree ("key");