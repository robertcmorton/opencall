CREATE TABLE "row_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"rundown_id" text NOT NULL,
	"row_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_name" text,
	"by_role" text,
	"body" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "row_notes" ADD CONSTRAINT "row_notes_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE cascade ON UPDATE no action;