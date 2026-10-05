ALTER TABLE "error_logs" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "error_logs" ADD COLUMN "resolution" text;