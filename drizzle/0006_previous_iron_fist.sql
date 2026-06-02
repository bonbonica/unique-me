ALTER TABLE "subscriptions" ADD COLUMN "period_start_date" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_batches" ADD COLUMN "batch_ordinal_in_period" integer;--> statement-breakpoint
--> backfill: set period_start_date to plan_changed_at for all existing rows
--> so existing Pro users (if any) get a sensible first period anchor and
--> non-Pro rows have a stable (harmless) value.
UPDATE "subscriptions" SET "period_start_date" = "plan_changed_at";