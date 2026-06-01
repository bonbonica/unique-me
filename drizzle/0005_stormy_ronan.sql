ALTER TABLE "subscriptions" ADD COLUMN "plan_changed_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_batches" ADD COLUMN "post_length" text;--> statement-breakpoint
--> backfill: existing subscription rows would get now() from the DEFAULT, which
--> would look to canGenerate like the plan just changed and grant a spurious
--> fresh batch. Backfill to created_at so the rolling-7-day window stays honest.
UPDATE "subscriptions" SET "plan_changed_at" = "created_at";