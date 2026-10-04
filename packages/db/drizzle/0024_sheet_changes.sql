CREATE TABLE "sheet_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"rundown_id" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"actor_name" text,
	"assistant" text,
	"summary" text NOT NULL,
	"before_snapshot_id" text,
	"detail" jsonb NOT NULL,
	"undone_by" text,
	"undoes" text
);
--> statement-breakpoint
ALTER TABLE "sheet_changes" ADD CONSTRAINT "sheet_changes_rundown_id_rundowns_id_fk" FOREIGN KEY ("rundown_id") REFERENCES "public"."rundowns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_changes" ADD CONSTRAINT "sheet_changes_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_changes" ADD CONSTRAINT "sheet_changes_before_snapshot_id_rundown_snapshots_id_fk" FOREIGN KEY ("before_snapshot_id") REFERENCES "public"."rundown_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sheet_changes_rundown_at_idx" ON "sheet_changes" USING btree ("rundown_id","at");