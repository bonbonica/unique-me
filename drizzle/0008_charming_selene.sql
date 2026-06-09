ALTER TABLE "profiles" ADD COLUMN "posting_days" text;--> statement-breakpoint
ALTER TABLE "weekly_batches" ADD COLUMN "day_window" integer;--> statement-breakpoint
ALTER TABLE "weekly_batches" ADD COLUMN "posting_days" text;