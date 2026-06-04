# Task 05: postService.deleteBatchForever

## Status
not started

## Wave
2

## Description

Add `deleteBatchForever(sessionUserId, batchId)` to `src/lib/services/post-service.ts`. Hard-delete a `cancelled` batch with image preservation: read the batch's posts, preserve their images to `library_images` via `imageService.retainImagesToLibrary`, then DELETE the `weekly_batches` row so the cascade cleans posts, `post_images`, `post_variations`, `post_selections`, and `scheduled_posts`.

Availability gate (D-S2-8): the batch must be `status='cancelled'`. Reviewing batches use the existing wizard discard flow — not this surface. Race-safe ownership check mirrors `stopBatch`.

## Dependencies

**Depends on:** task-03 (`imageService.retainImagesToLibrary`).
**Blocks:** task-08 (`<DeleteBatchForeverDialog />` server action), Wave 3 `<UnscheduledBatchCard />` destructive action.
**Parallel with:** task-04 (same file; see file-region note below), task-06 (different file).

**File-region note (parallelism):** task-04 and task-05 both edit `post-service.ts`. Task-04 adds `cancelPost` directly after the existing `stopBatch` function. Task-05 places `deleteBatchForever` and its result type at the **end of the file**, after the last existing export. The two regions don't overlap, so the wave can run in parallel.

## Files to Modify

- `src/lib/services/post-service.ts` — append `DeleteBatchForeverResult` type and `deleteBatchForever` function at the bottom of the file. Add `imageService` import if task-04 hasn't added it yet (coordinate via a single import line — both tasks need the same alias).

## Implementation Steps

### 1. Imports

If not already added by task-04, add at the top of `post-service.ts`:

```ts
import * as imageService from "./image-service";
```

Both tasks need the same alias — if both attempt to add the import line, the second to land will get a duplicate and should remove its copy. Prefer the existing line.

### 2. Return type — placed at the end of the file

```ts
export type DeleteBatchForeverResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "not_cancelled" | "db_failed";
    };
```

### 3. Function — placed at the end of the file (after the last existing export)

```ts
/**
 * Hard-delete a cancelled batch with image preservation (D-S2-8).
 *
 * Mirrors cancelPost's order:
 *   1. Read batch (ownership + status gate).
 *   2. Read postIds for the batch (could be 0).
 *   3. Preserve images via image-service (cap eviction handled there).
 *   4. DELETE weekly_batches row (cascade cleans posts → post_images → etc.).
 *
 * Only `status = 'cancelled'` batches qualify. Reviewing batches go through
 * the wizard discard flow, not this surface.
 */
export async function deleteBatchForever(
  sessionUserId: string,
  batchId: string,
): Promise<DeleteBatchForeverResult> {
  // 1. Ownership + status gate.
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
  if (batch.status !== "cancelled") {
    return { ok: false, error: "not_cancelled" };
  }

  // 2. Collect post IDs (could be empty if the user cancelled every post
  // individually before deleting the batch).
  const postRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.batchId, batchId));

  const postIds = postRows.map((r) => r.id);

  // 3. Preserve images. image-service is a no-op for empty input.
  if (postIds.length > 0) {
    const retain = await imageService.retainImagesToLibrary(
      sessionUserId,
      postIds,
    );
    if (!retain.ok) {
      return { ok: false, error: retain.error };
    }
  }

  // 4. Hard-delete the batch. Status guard is defense in depth (matches
  // stopBatch's pattern — race-safe if another tab cancelled the batch's
  // status between our read and our delete).
  try {
    const result = await db
      .delete(weeklyBatches)
      .where(
        and(
          eq(weeklyBatches.id, batchId),
          eq(weeklyBatches.userId, sessionUserId),
          eq(weeklyBatches.status, "cancelled"),
        ),
      )
      .returning({ id: weeklyBatches.id });

    if (result.length === 0) {
      // Lost a race — batch status changed under us. Idempotent outcome.
      return { ok: false, error: "not_found" };
    }

    return { ok: true };
  } catch (err) {
    console.error("[postService.deleteBatchForever]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

### 4. Imports sanity check

Confirm `weeklyBatches`, `posts`, `and`, `eq` are already imported at the top of the file (they are — `stopBatch` uses them). No new schema imports required beyond `imageService`.

## Acceptance Criteria

- [ ] `postService.deleteBatchForever(sessionUserId, batchId)` exists, exported, and typed to `Promise<DeleteBatchForeverResult>`.
- [ ] Function is placed at the end of `post-service.ts`, after the last existing export (file-region rule per dependencies section).
- [ ] Returns `{ ok: false, error: "not_found" }` when `batchId` does not exist.
- [ ] Returns `{ ok: false, error: "not_owned" }` when `weeklyBatches.userId !== sessionUserId`. No DB writes happen.
- [ ] Returns `{ ok: false, error: "not_cancelled" }` when `status !== "cancelled"` (covers `reviewing`, `scheduling`, `completed`, `in_progress`).
- [ ] Handles `postIds.length === 0` gracefully (skips image-service call entirely; proceeds to batch delete).
- [ ] On the success path: `imageService.retainImagesToLibrary(sessionUserId, postIds)` is called BEFORE the `DELETE FROM weekly_batches`.
- [ ] The DELETE is guarded by `userId = sessionUserId AND status = 'cancelled'` (defense in depth against TOCTOU).
- [ ] Returns `{ ok: true }` on success.
- [ ] DB error during delete returns `{ ok: false, error: "db_failed" }` and logs `[postService.deleteBatchForever]` to console.
- [ ] User-isolation regression: a call with `sessionUserId = userA` against a batch owned by `userB` produces `not_owned`; `userB`'s `library_images` count is unchanged.
- [ ] Concurrent-tabs regression: two simultaneous calls — first returns `{ ok: true }`; second returns `{ ok: false, error: "not_found" }` (the second call finds the batch already gone after the first's DELETE).
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- Cap eviction during retain is handled entirely by `image-service` — this function does not know or care about the 30-image cap. If retain returns `not_owned`, surface the same error code so the UI can show a generic "couldn't save images" toast.
- The cascade from `weekly_batches` removes the `posts` rows BEFORE Postgres tries to remove `post_images` (cascade ordering is deterministic via FK), so by the time `post_images` rows go, their URLs are already owned by `library_images`. No window where the blob is unreferenced.
- Empty-postIds case is real: a user can cancel every post via per-post cancel (task-04), leaving a cancelled batch with 0 posts but still a card on `/create`. `Delete forever` on that card should succeed and just remove the row.

## Out of scope

- Deleting `reviewing` batches via this surface. The wizard discard flow handles that today; surfacing here would risk skipping the wizard's confirmation copy.
- Undo. Same future-spec deferral as task-04.
- Bulk delete of multiple cancelled batches at once. UI is per-card in Stage-2.
- Notifying the user when retain triggers a Library eviction. Spec defers that surface (the future eviction toast `"Oldest image replaced to make room."` is mentioned in §9 risks but not wired in Stage-2).
