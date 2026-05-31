# Task 01: Schema Migration 0005

## Status
not started

## Wave
1

## Description

Add two columns required by the rest of Phase 3:

- `weekly_batches.post_length` — text, nullable. Captures the per-batch length choice (short/medium/long); NULL means "treat as medium" (back-compat with Phase 2 batches).
- `subscriptions.plan_changed_at` — timestamp, not null, default `now()`. Lets `canGenerate` detect a plan change and grant a fresh batch on upgrade (D5). Don't reuse `updatedAt` — that fires on unrelated bumps.

Workflow: edit schema → `npm run db:generate` → review SQL → backfill `plan_changed_at` for existing rows → `npm run db:migrate`. **Never `db:push`** (AGENTS.md).

## Dependencies

**Depends on:** none
**Blocks:** task-03 (canGenerate reads `plan_changed_at`), task-06 (postService writes `post_length`)
**Context from dependencies:** N/A — foundation task.

## Files to Modify

- `src/lib/schema.ts` (modified) — two column additions + `PostLength` union export
- `drizzle/0005_<autoname>.sql` (new) — generated migration; add backfill UPDATE before applying

## Implementation Steps

1. Edit `src/lib/schema.ts`:
   - Inside the `weeklyBatches` `pgTable(...)` definition, add `postLength: text("post_length")` (nullable; no default).
   - Inside the `subscriptions` `pgTable(...)` definition, add `planChangedAt: timestamp("plan_changed_at").notNull().defaultNow()`.
   - In the unions section near the bottom, add `export type PostLength = "short" | "medium" | "long";`.
2. Run `npm run db:generate`. Drizzle Kit writes `drizzle/0005_<name>.sql`.
3. Read the generated SQL. Expect:
   - `ALTER TABLE "weekly_batches" ADD COLUMN "post_length" text;`
   - `ALTER TABLE "subscriptions" ADD COLUMN "plan_changed_at" timestamp DEFAULT now() NOT NULL;`
4. **Backfill** `plan_changed_at` for existing rows. The `DEFAULT now()` will populate existing rows at migrate time, but that's wrong for our gate logic (Phase-2-era trial users would look like they just plan-changed → spurious fresh-batch grant). Append to the migration SQL:
   ```sql
   --> backfill: set plan_changed_at to created_at for all existing rows so
   --> canGenerate doesn't think the plan just changed.
   UPDATE "subscriptions" SET "plan_changed_at" = "created_at";
   ```
5. Run `npm run db:migrate`. Open Drizzle Studio and confirm:
   - Both columns exist with the right types.
   - Every existing `subscriptions` row has `plan_changed_at <= created_at + 5s` (i.e., the backfill ran).
   - Every existing `weekly_batches` row has `post_length = NULL`.

## Acceptance Criteria

- [ ] `weekly_batches.post_length` exists (text, nullable) — confirmed in Drizzle Studio.
- [ ] `subscriptions.plan_changed_at` exists (timestamp, not null, default `now()`) — confirmed in Drizzle Studio.
- [ ] All pre-existing `subscriptions` rows have `plan_changed_at = created_at` (backfill ran).
- [ ] `PostLength` union exported from `src/lib/schema.ts`.
- [ ] `npm run typecheck` exits 0 after schema changes.
- [ ] `drizzle/0005_*.sql` committed.
- [ ] No `db:push` invocation anywhere in git history for this work.

## Notes

- The backfill is the only reason this isn't a stock auto-generated migration. Without it, every Phase-2 trial user would get a free new batch immediately after Phase 3 ships.
- `post_length` being nullable is intentional — Phase 2 batches predate it, and render/prompt sites must treat NULL as `"medium"`.
- We don't add a CHECK constraint for the post-length values; the union is enforced at the service layer (matches Phase 2 convention for enum-like text columns).
