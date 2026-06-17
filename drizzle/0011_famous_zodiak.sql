ALTER TABLE "library_images" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "library_images" ADD COLUMN "last_used_at" timestamp;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_cleanup_check_month" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "monthly_cleanup_reminder_dismissed" boolean DEFAULT false NOT NULL;