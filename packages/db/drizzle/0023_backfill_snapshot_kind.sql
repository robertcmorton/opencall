UPDATE "rundown_snapshots" SET "kind" = 'show_start' WHERE "kind" IS NULL AND "label" = 'Show start';--> statement-breakpoint
UPDATE "rundown_snapshots" SET "kind" = 'import' WHERE "kind" IS NULL AND "label" = 'Before update';--> statement-breakpoint
UPDATE "rundown_snapshots" SET "kind" = 'restore' WHERE "kind" IS NULL AND "label" = 'Before restore';--> statement-breakpoint
UPDATE "rundown_snapshots" SET "kind" = 'assistant' WHERE "kind" IS NULL AND "label" LIKE 'Before changes by %';--> statement-breakpoint
UPDATE "rundown_snapshots" SET "kind" = 'manual' WHERE "kind" IS NULL;
