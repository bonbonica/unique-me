# Task 01: Schema Migration 0006

## Status
not started

## Wave
1

## Description

Add two columns required by Phase 4 Section A:

- `subscriptions.period_start_date` — timestamp, not null, default `now()`. The immutable anchor for the Pro rolling 30-day quota window (D-A7). Unused for trial/Starter rows.
- `weekly_batches.batch_ordinal_in_period` — integer, nullable. Stores the Pro batch's ordinal position (1, 2, 3, or 4) in the current period (D-A9). Non-Pro batches stay NULL.

Workflow: edit schema → `pnpm db:generate` → review SQL → append backfill UPDATE for `period_start_date` → `pnpm db:migrate`. **Never `db:push`** (AGENTS.md).

## Dependencies

**Depends on:** none
**Blocks:** task-04 (`canGenerate` reads `period_start_date`), task-10 (`postService` writes `batch_ordinal_in_period`)
**Context from dependencies:** N/A — foundation task.

## Files to Modify

- `src/lib/schema.ts` (modified) — two column additions
- `drizzle/0006_<autoname>.sql` (new) — generated migration; append backfill UPDATE before applying
- `drizzle/meta/_journal.json` (modified, auto-generated)

## Implementation Steps

1. Edit `src/lib/schema.ts`:
   - Inside the `subscriptions` `pgTable(...)` definition (around line 327), add:
     ```ts
     periodStartDate: timestamp("period_start_date").notNull().defaultNow(),
     ```
     Place adjacent to `planChangedAt` for narrative grouping.
   - Inside the `weeklyBatches` `pgTable(...)` definition, add:
     ```ts
     batchOrdinalInPeriod: integer("batch_ordinal_in_period"),
     ```
     Nullable (no `.notNull()`). Non-Pro batches will leave it NULL.
2. Run `pnpm db:generate`. Drizzle Kit writes `drizzle/0006_<name>.sql`.
3. Read the generated SQL. Expect:
   - `ALTER TABLE "subscriptions" ADD COLUMN "period_start_date" timestamp DEFAULT now() NOT NULL;`
   - `ALTER TABLE "weekly_batches" ADD COLUMN "batch_ordinal_in_period" integer;`
4. **Backfill `period_start_date` for existing rows.** The `DEFAULT now()` populates new inserts but is wrong for pre-existing rows — Pro users from Phase 3 (if any) would get a brand-new period anchor at migrate time. Append to the migration SQL:
   ```sql
   --> backfill: set period_start_date to plan_changed_at for all existing rows
   --> so existing Pro users (if any) get a sensible first period anchor and
   --> non-Pro rows have a stable (harmless) value.
   UPDATE "subscriptions" SET "period_start_date" = "plan_changed_at";
   ```
5. Run `pnpm db:migrate`. Open Drizzle Studio and confirm:
   - Both columns exist with the right types.
   - Every existing `subscriptions` row has `period_start_date = plan_changed_at` (backfill ran).
   - Every existing `weekly_batches` row has `batch_ordinal_in_period = NULL`.

## Acceptance Criteria

- [ ] `subscriptions.period_start_date` exists (timestamp, not null, default `now()`) — confirmed in Drizzle Studio.
- [ ] `weekly_batches.batch_ordinal_in_period` exists (integer, nullable) — confirmed in Drizzle Studio.
- [ ] All pre-existing `subscriptions` rows have `period_start_date = plan_changed_at` (backfill ran).
- [ ] `pnpm typecheck` exits 0 after schema changes.
- [ ] `drizzle/0006_*.sql` committed with the backfill UPDATE included.
- [ ] No `db:push` invocation anywhere in git history for this work.

## Notes

- The backfill is the only reason this isn't a stock auto-generated migration. Without it, any Pro row's first `canGenerate` call after migrate would see `period_start_date = now()` instead of the user's true subscription anchor — masking real billing history.
- `batch_ordinal_in_period` being nullable is intentional — Starter/Trial batches predate the column and have no meaningful ordinal.
- We do NOT add a CHECK constraint for `batch_ordinal_in_period IN (1,2,3,4)` — the union is enforced at the service layer (matches Phase 3 convention for enum-like columns).
- The new column gets indexed only if query plans show a problem. Phase 3 didn't index `plan_changed_at` either; the COUNT query in `canGenerate` is already cheap with the existing `user_id` index.
