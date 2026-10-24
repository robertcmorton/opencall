CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"who" text,
	"role" text,
	"device_id" text,
	"device" text,
	"ip" text,
	"place" text,
	"country" text,
	"rundown_id" text,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "show_transitions" ADD COLUMN "who" text;--> statement-breakpoint
ALTER TABLE "show_transitions" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "show_transitions" ADD COLUMN "device" text;--> statement-breakpoint
ALTER TABLE "show_transitions" ADD COLUMN "ip" text;--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_user_idx" ON "activity" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_rundown_idx" ON "activity" USING btree ("rundown_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_device_idx" ON "activity" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_ip_idx" ON "activity" USING btree ("ip","created_at");