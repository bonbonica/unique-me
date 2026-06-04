# Task 06: schedule-service.ts + rolling-4 eviction

## Status
not started

## Wave
2

## Description

Create `src/lib/services/schedule-service.ts` with `scheduleBatch(sessionUserId, batchId)`. Flips a batch from `reviewing → scheduling` with a status-guarded UPDATE (race-safe, mirrors `stopBatch`). After the flip, counts `scheduling + completed` batches for the user; if the count would push from 4 to 5, the oldest-by-`createdAt` batch is evicted via `imageService.deleteImagesPermanently` + cascading row delete. Returns `evictedBatchId` so the UI can surface the toast.

Transaction boundary: the schedule UPDATE and the eviction DELETE share one `db.transaction`. Blob calls happen **outside** the transaction — network calls in an open txn risk connection leaks. The failure semantics from spec §5.4 last paragraph are documented inline.

## Dependencies

**Depends on:** task-03 (`imageService.deleteImagesPermanently`).
**Blocks:** none in Wave 2. Wave 4+ UI consumes via a server action wrapper.
**Parallel with:** task-03, task-04, task-05 (different files).

## Files to Create

- `src/lib/services/schedule-service.ts` (new).

## Implementation Steps

### 1. Module header + imports

```ts
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, weeklyBatches } from "@/lib/schema";
import * as imageService from "./image-service";

const ROLLING_CAP = 4;

export type ScheduleBatchResult =
  | { ok: true; batchId: string; evictedBatchId: string | null }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "not_reviewing" | "db_failed";
    };
```

### 2. `scheduleBatch(sessionUserId, batchId)`

```ts
/**
 * Flip a reviewing batch to scheduling and apply rolling-4 eviction
 * (D-S2-2, D-S2-3, spec §5.4).
 *
 * Status-guarded UPDATE is race-safe (matches stopBatch's pattern). The
 * UPDATE + the eviction DELETE share one db.transaction. Blob deletes are
 * issued AFTER the transaction commits — network calls in an open txn
 * risk connection leaks.
 *
 * Failure semantics:
 *   - Step 1 UPDATE fails (0 rows affected) → not_reviewing, no state change.
 *   - Step 3 blob deletes fail → orphans logged via image-service, txn
 *     continues and DELETE proceeds.
 *   - Step 3 DELETE fails → eviction is rolled back. The status flip
 *     stays committed because steps 1 and 3 share the same txn — they
 *     either both commit or both roll back. The user temporarily has
 *     5 scheduled batches; the next scheduleBatch (or manual cleanup)
 *     re-attempts eviction.
 *
 * NOTE on transactionality: see the inline comment block before the
 * db.transaction() call. The blob deletes have to run between the SELECT
 * of the evicted post IDs (inside the txn for consistency) and the DELETE
 * of the batch row (also inside the txn so cascade is atomic with the
 * eviction). We exit the txn briefly to run blob deletes, then re-enter
 * a second tx for the DELETE? That's a leak. The spec's compromise:
 * run blob deletes BETWEEN the schedule-UPDATE commit and the DELETE,
 * structured as TWO short transactions chained sequentially.
 */
export async function scheduleBatch(
  sessionUserId: string,
  batchId: string,
): Promise<ScheduleBatchResult> {
  // 1. Ownership pre-check (cheap; the guarded UPDATE is the real authority).
  const [batch] = await db
    .select({
      userId: weeklyBatches.userId,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) return { ok: false, error: "not_owned" };
  if (batch.status !== "reviewing") {
    return { ok: false, error: "not_reviewing" };
  }

  // 2. Status-guarded UPDATE in its own short transaction. If 0 rows
  // affected, another tab won the race — surface not_reviewing.
  let evictionCandidateId: string | null = null;
  let evictionPostIds: string[] = [];

  try {
    await db.transaction(async (tx) => {
      const updateResult = await tx
        .update(weeklyBatches)
        .set({ status: "scheduling" })
        .where(
          and(
            eq(weeklyBatches.id, batchId),
            eq(weeklyBatches.userId, sessionUserId),
            eq(weeklyBatches.status, "reviewing"),
          ),
        )
        .returning({ id: weeklyBatches.id });

      if (updateResult.length === 0) {
        throw new Error("__not_reviewing__");
      }

      // 3. Count scheduling + completed AFTER the flip is committed in
      // this txn. If ≥ ROLLING_CAP + 1 (i.e. 5), find the oldest excluding
      // the just-flipped batch. The just-flipped batch IS one of the rows
      // in the count, but it's the newest by createdAt, so the oldest is
      // always one of the previous 4.
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(weeklyBatches)
        .where(
          and(
            eq(weeklyBatches.userId, sessionUserId),
            inArray(weeklyBatches.status, ["scheduling", "completed"]),
          ),
        );

      if (count > ROLLING_CAP) {
        const [oldest] = await tx
          .select({ id: weeklyBatches.id })
          .from(weeklyBatches)
          .where(
            and(
              eq(weeklyBatches.userId, sessionUserId),
              inArray(weeklyBatches.status, ["scheduling", "completed"]),
            ),
          )
          .orderBy(asc(weeklyBatches.createdAt))
          .limit(1);

        if (oldest && oldest.id !== batchId) {
          evictionCandidateId = oldest.id;

          // Read postIds inside the txn so the DELETE in step 5 can't
          // miss rows from a concurrent insert.
          const postRows = await tx
            .select({ id: posts.id })
            .from(posts)
            .where(eq(posts.batchId, oldest.id));
          evictionPostIds = postRows.map((r) => r.id);
        }
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "__not_reviewing__") {
      return { ok: false, error: "not_reviewing" };
    }
    console.error("[scheduleService.scheduleBatch:flip]", err);
    return { ok: false, error: "db_failed" };
  }

  // 4. Blob deletes run BETWEEN the two transactions. Failures swallowed
  // by image-service and logged to post_logs.action='blob_orphan'.
  if (evictionCandidateId && evictionPostIds.length > 0) {
    const purge = await imageService.deleteImagesPermanently(
      sessionUserId,
      evictionPostIds,
    );
    if (!purge.ok) {
      // not_owned here would indicate an ownership mismatch we already
      // screened for — log and abandon eviction. The status flip stays
      // committed.
      console.error(
        "[scheduleService.scheduleBatch:purge]",
        purge.error,
        evictionCandidateId,
      );
      return { ok: true, batchId, evictedBatchId: null };
    }
  }

  // 5. Final txn: DELETE the evicted batch row. Cascade cleans posts,
  // post_images, post_variations, post_selections, scheduled_posts.
  if (evictionCandidateId) {
    try {
      const deleteResult = await db
        .delete(weeklyBatches)
        .where(
          and(
            eq(weeklyBatches.id, evictionCandidateId),
            eq(weeklyBatches.userId, sessionUserId),
          ),
        )
        .returning({ id: weeklyBatches.id });

      if (deleteResult.length === 0) {
        // Lost a race — another path deleted it. Idempotent.
        return { ok: true, batchId, evictedBatchId: null };
      }

      return { ok: true, batchId, evictedBatchId: evictionCandidateId };
    } catch (err) {
      console.error("[scheduleService.scheduleBatch:evict]", err);
      // The status flip stays committed; user sees 5 scheduled batches
      // temporarily. Next scheduleBatch retries eviction.
      return { ok: true, batchId, evictedBatchId: null };
    }
  }

  return { ok: true, batchId, evictedBatchId: null };
}
```

### 3. Optional barrel export

If `src/lib/services/index.ts` re-exports services as namespaces, add `export * as scheduleService from "./schedule-service"`. Otherwise import directly.

## Acceptance Criteria

- [ ] `src/lib/services/schedule-service.ts` exists and exports `scheduleBatch` typed to `Promise<ScheduleBatchResult>`.
- [ ] Status-guarded UPDATE: only fires when `status = 'reviewing'`. Returns `not_reviewing` when 0 rows affected.
- [ ] Returns `not_found` for unknown `batchId`, `not_owned` when `userId` mismatch, `not_reviewing` for any other status (`scheduling`, `cancelled`, `completed`, `in_progress`).
- [ ] Count query uses `status IN ('scheduling', 'completed')` per D-S2-1.
- [ ] When count > 4, oldest-by-`createdAt` batch (excluding the just-flipped batch) is selected for eviction.
- [ ] When count ≤ 4, returns `{ ok: true, batchId, evictedBatchId: null }` with no further work.
- [ ] `imageService.deleteImagesPermanently` is called with the evicted batch's `posts.id` list BEFORE the eviction `DELETE`.
- [ ] The eviction `DELETE` runs in its own transaction, separate from the schedule flip. Blob calls do not happen inside any open `db.transaction`.
- [ ] On `deleteImagesPermanently` failure: status flip stays committed; function returns `{ ok: true, batchId, evictedBatchId: null }` and logs the error.
- [ ] On eviction DELETE failure: status flip stays committed; function returns `{ ok: true, batchId, evictedBatchId: null }` and logs the error. The user temporarily has 5 scheduled batches; documented as self-healing on the next `scheduleBatch` call.
- [ ] User-isolation regression: `scheduleBatch(userA, batchOwnedByB)` returns `not_owned`; userB's batches and library are untouched.
- [ ] Pro-user 5th-batch happy path: starting at 4 `scheduling` batches, calling `scheduleBatch` on a 5th `reviewing` batch leaves the user with 4 `scheduling` batches and `evictedBatchId === <oldest batch's id>`.
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- The `__not_reviewing__` error-as-control-flow inside the txn is the standard Drizzle pattern for surfacing a guarded-UPDATE miss without a separate boolean flag. Caught in the surrounding `catch` and translated to the typed error.
- The just-flipped batch is the **newest** by `createdAt` (it was the `reviewing` batch the user just confirmed). The `asc(createdAt)` ORDER BY guarantees the oldest is picked. The `oldest.id !== batchId` defensive check is belt-and-braces in case timestamps collide to the millisecond.
- The two-transaction structure is the deliberate trade-off from spec §5.4 last paragraph: atomicity of the flip + eviction-prep in txn 1, blob network calls between, atomicity of the cascade in txn 2. The cost is the partial-failure window where the user has 5 scheduled batches; the mitigation is self-healing on the next call.
- Phase 4 cron auto-scheduler (deferred) will call `scheduleBatch` instead of user-initiating it. Behavior identical.

## Out of scope

- Phase 4 cron job that picks the next `reviewing` batch automatically. Stage-2 is user-initiated only (§0 deferred).
- Wizard step changes. The wizard calls `scheduleBatch` via a server action wrapper, but that wrapper is a Wave 4+ task. This task ships only the service function.
- Surfacing the eviction toast in the UI. Wave 4 reads `evictedBatchId` from the result and renders the copy.
- Soft-delete for the evicted batch. Per spec §5.4: eviction is hard-delete with image purge. Future soft-delete spec will rewire the evict path through `retainImagesToLibrary` instead.
- Per-platform schedule row creation in `scheduled_posts`. That's Phase 4's job. Stage-2's `scheduleBatch` only flips the batch status and handles eviction; the wizard's existing logic still writes `scheduled_posts` rows.
