-- Idempotent ADD COLUMN: this migration was applied to production manually
-- via the Neon SQL editor before drizzle-kit ran it. Without IF NOT EXISTS,
-- the subsequent automated `pnpm db:migrate` in Vercel's build would fail
-- with "column already exists" because the __drizzle_migrations row was
-- never written. With IF NOT EXISTS the ALTER is a no-op when the column
-- is present and drizzle still records the migration as applied — keeping
-- the journal and the live schema in sync without manual SQL fix-ups.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "generate_images_automatically" boolean DEFAULT true NOT NULL;