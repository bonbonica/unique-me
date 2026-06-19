# Task 06: stopBatch cancels child scheduled_posts rows

## Status

pending

## Wave

2

## Description

**Repurposed 2026-06-19** following the design pivot to a single-list Cancelled Posts page (no separate "Cancelled batches" section). Originally this task built the batches section; under the new design, every cancelled item — whether one-off or part of a whole-batch cancel — is treated as an individual cancelled post and surfaces in the single list on `/cancelled-posts`.

For the Wave 4 single-list query (task-11) to find batch-cancelled posts via the same `status = 'cancelled'` filter it uses for per-post cancels, the `postService.stopBatch` action must also flip every child `scheduled_posts.status` from `'pending'` to `'cancelled'` in the same transaction that flips `weeklyBatches.status` to `'cancelled'`. Today (per the exploration report) `stopBatch` only updates `weeklyBatches.status` and leaves child rows untouched at `'pending'` — so without this change those posts would still look schedulable, which is wrong.

This is a data-layer change: no UI work in this task. Wave 4 task-11 builds on top of it.

## Dependencies

**Depends on:** task-01, task-02, task-03, task-04, task-05 (all of Wave 1)
**Blocks:** task-11 (the single-list query relies on the unified `scheduled_posts.status = 'cancelled'` semantics this task establishes)

**Context from dependencies:** Wave 1 stripped the cancelled-batch surfacing from `/create` and created the `/cancelled-posts` shell with one empty list. This task does NOT touch any UI; it changes the cancel semantics at the service layer so the Wave 4 single-list query has clean data to read.

## Files to Create

None.

## Files to Modify

- `src/lib/services/post-service.ts` — extend `stopBatch(batchId, userId)` so its transaction includes:
  ```sql
  UPDATE scheduled_posts
     SET status = 'cancelled', cancelled_at = NOW()  -- if column exists; else just status
   WHERE post_id IN (SELECT id FROM posts WHERE batch_id = ?)
     AND status = 'pending';
  ```
  Adjust column names to match the actual Drizzle schema. Run inside the same `db.transaction(...)` block that flips `weeklyBatches.status` so the two writes are atomic.
- Any service-level tests for `stopBatch` (search `src/lib/services/__tests__/`) — extend an existing test or add a small case asserting that after `stopBatch`, every previously-`pending` `scheduled_posts` row for the batch's posts is now `cancelled`. (Per `AGENTS.md`: no NEW test infrastructure; only extend if a test file already exists. If none, skip and document in handoff.)

## Files to Delete

None.

## Technical Details

### Implementation Steps

1. **Read the current `stopBatch` implementation** (post-service.ts:1632 per the exploration report). Note the transaction scope, ownership/status guards, and return shape.
2. **Within the same transaction**, after the `weeklyBatches` status flip, add a bulk update against `scheduled_posts`:
   - Filter: `post_id` belongs to this batch AND `status = 'pending'`.
   - Set: `status = 'cancelled'` (and `cancelled_at = now()` / `updated_at = now()` if those columns exist per the schema).
3. **Do not flip rows that are already `posted` or `failed`** — they are terminal states and must stay. The `status = 'pending'` filter handles this.
4. **Do not introduce a new column or schema migration.** Use whatever timestamp columns already exist on `scheduled_posts`.
5. **Verify with a quick reality check** in the dev environment if convenient: create a batch, schedule it, hit `stopBatch`, then `SELECT status FROM scheduled_posts WHERE post_id IN (...)` — every row should read `cancelled`.
6. **Run quality gates:** `pnpm lint`, `pnpm typecheck`, `pnpm build`.

### Notes on backward compatibility

- The previous `stopBatch` behavior left child rows at `'pending'`. After this change, any code that read `scheduled_posts.status` and expected `'pending'` for a cancelled-batch's posts will read `'cancelled'` instead. Grep for `scheduled_posts` and `status: "pending"` (or equivalent) to confirm no caller depends on the old semantics.
- Likely affected callers (if any):
  - Posting worker (when Phase 7 ships) — already needs to skip `cancelled`.
  - Reporting / counts queries — should now correctly exclude cancelled batches' rows.
- Phase-2 cancelled-recoverable flow (NetworkWizard `mode="cancelled"`) operates against `posts`, not `scheduled_posts`, so it is unaffected.

### Notes on what NOT to change

- Do not modify `cancelPost` (per-post cancel). It already does what this task makes `stopBatch` do for the whole batch.
- Do not delete `scheduled_posts` rows. The semantic is "flipped to cancelled", not "removed".
- Do not add UI work. The single-list view is task-11 (Wave 4).
- Do not change the `stopBatch` return shape.

## Acceptance Criteria

- [ ] After `stopBatch(batchId, userId)` returns successfully, every previously-`pending` `scheduled_posts` row whose parent `posts.batchId = batchId` has `status = 'cancelled'`.
- [ ] Already-`posted` and already-`failed` rows are left untouched.
- [ ] The status flip and the batch status flip are in the same transaction (one fails → both roll back).
- [ ] No grep hits for callers that depended on the old "cancelled batch but pending scheduled_posts" semantics.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

This is the "make data unified" prep task for the single-list Cancelled Posts design. Without it, batch-cancelled posts would be invisible to the simple `WHERE status = 'cancelled'` query the Wave 4 list relies on.
