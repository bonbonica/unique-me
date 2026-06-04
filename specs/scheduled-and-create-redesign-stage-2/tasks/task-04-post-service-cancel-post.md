# Task 04: postService.cancelPost

## Status
not started

## Wave
2

## Description

Add `cancelPost(sessionUserId, postId)` to `src/lib/services/post-service.ts`. Per-post hard-delete with image preservation: read the post's `post_images` URLs, preserve them to `library_images` via `imageService.retainImagesToLibrary`, then DELETE the `posts` row so the cascade cleans `post_images`, `post_variations`, `post_selections`, and `scheduled_posts`.

Availability gate (D-S2-7): the post must have at least one `scheduled_posts` row with `scheduledTime > now()` AND no row with `status='posted'`. Otherwise returns `already_posted`. Race-safe ownership check mirrors the `stopBatch` pattern.

## Dependencies

**Depends on:** task-03 (`imageService.retainImagesToLibrary`).
**Blocks:** task-15 (per-post `[Cancel]` UI on `/schedule/[batchId]`).
**Parallel with:** task-05 (same file; see file-region note below), task-06 (different file).

**File-region note (parallelism):** task-04 and task-05 both edit `post-service.ts`. To avoid mid-merge conflicts, **add `cancelPost` immediately after the existing `stopBatch` function** (around line 1265 today). Task-05 places `deleteBatchForever` at the **end of the file**, after the last existing export. The two regions don't overlap.

## Files to Modify

- `src/lib/services/post-service.ts` — add the `CancelPostResult` type, the `cancelPost` function, and an `imageService` import.

## Implementation Steps

### 1. Imports

At the top of `post-service.ts`, alongside the existing service imports:

```ts
import * as imageService from "./image-service";
```

Add `scheduledPosts` to the `@/lib/schema` import list if it's not already there. Add `gt`, `or` to the `drizzle-orm` import list if absent.

### 2. Return type

Near the other result-shape unions (next to `StopResult`):

```ts
export type CancelPostResult =
  | { ok: true; batchId: string }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "already_posted" | "db_failed";
    };
```

### 3. Function — placed directly after `stopBatch`

```ts
/**
 * Hard-delete one post with image preservation (D-S2-6, D-S2-7).
 *
 * Order is invariant:
 *   1. Read post (ownership gate).
 *   2. Read scheduled_posts rows (availability gate).
 *   3. Preserve images to library (image-service handles ordering + lock).
 *   4. DELETE posts row (cascade cleans post_images, post_variations,
 *      post_selections, scheduled_posts).
 *
 * The image blob stays alive — library_images.imageUrl now owns it. The
 * post_images row vanishes via cascade.
 */
export async function cancelPost(
  sessionUserId: string,
  postId: string,
): Promise<CancelPostResult> {
  // 1. Ownership gate.
  const [post] = await db
    .select({
      userId: posts.userId,
      batchId: posts.batchId,
    })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post) return { ok: false, error: "not_found" };
  if (post.userId !== sessionUserId) return { ok: false, error: "not_owned" };

  // 2. Availability gate (D-S2-7): at least one future-scheduled row AND no
  // posted row.
  const scheduleRows = await db
    .select({
      status: scheduledPosts.status,
      scheduledTime: scheduledPosts.scheduledTime,
    })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.postId, postId));

  const now = new Date();
  const anyPosted = scheduleRows.some((r) => r.status === "posted");
  const anyFuture = scheduleRows.some(
    (r) => r.scheduledTime.getTime() > now.getTime(),
  );

  // No schedule rows = nothing to cancel (the post hasn't been scheduled).
  // Treat that as "not_found" rather than crashing — the UI should never offer
  // the action in that state.
  if (scheduleRows.length === 0 || anyPosted || !anyFuture) {
    return { ok: false, error: "already_posted" };
  }

  // 3. Preserve images. image-service enforces ownership again as a defense
  // in depth and handles the per-user advisory lock.
  const retain = await imageService.retainImagesToLibrary(sessionUserId, [
    postId,
  ]);
  if (!retain.ok) {
    // not_owned here would indicate a race we already screened for — bubble
    // up the same error code for the UI toast.
    return { ok: false, error: retain.error };
  }

  // 4. Hard-delete. Cascade fires.
  try {
    const result = await db
      .delete(posts)
      .where(and(eq(posts.id, postId), eq(posts.userId, sessionUserId)))
      .returning({ id: posts.id });

    if (result.length === 0) {
      // Lost a race — another request deleted the post between our ownership
      // read and our DELETE. Idempotent outcome: nothing to do.
      return { ok: false, error: "not_found" };
    }

    return { ok: true, batchId: post.batchId };
  } catch (err) {
    console.error("[postService.cancelPost]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

### 4. Re-check the `or` import

The availability gate uses `.some()` on the JS side rather than a DB-side `OR`, so `or` from drizzle is NOT required for this function. If `or` isn't already imported, do not add it as part of this task.

## Acceptance Criteria

- [ ] `postService.cancelPost(sessionUserId, postId)` exists, exported, and typed to `Promise<CancelPostResult>`.
- [ ] Function is placed immediately after `stopBatch` in `post-service.ts` (file-region rule per dependencies section).
- [ ] Returns `{ ok: false, error: "not_found" }` when `postId` does not exist.
- [ ] Returns `{ ok: false, error: "not_owned" }` when `posts.userId !== sessionUserId`. No DB writes happen.
- [ ] Returns `{ ok: false, error: "already_posted" }` when any `scheduled_posts.status === "posted"`, OR when all `scheduledTime <= now()`, OR when there are zero `scheduled_posts` rows.
- [ ] On the success path: `imageService.retainImagesToLibrary(sessionUserId, [postId])` is called BEFORE the `DELETE FROM posts`.
- [ ] The DELETE is guarded by `userId = sessionUserId` (defense in depth against TOCTOU between the read and the delete).
- [ ] Returns `{ ok: true, batchId }` with the original post's `batchId`.
- [ ] DB error during delete returns `{ ok: false, error: "db_failed" }` and logs `[postService.cancelPost]` to console.
- [ ] User-isolation regression: a call with `sessionUserId = userA` against a post owned by `userB` produces `not_owned` and leaves `userB`'s `library_images` count unchanged.
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- The "already_posted" error also covers the "no schedule rows" case (post exists but was never scheduled). The UI never reaches this branch via the `/schedule/[batchId]` detail page — only scheduled posts surface there. Returning a known error code is safer than throwing.
- The cascade from `posts` removes `scheduled_posts` rows, so any future cron job (Phase 4) that races with this cancel will find zero rows in its per-row `where status='pending'` UPDATE and silently no-op. See spec §7.7.
- The image URL ownership transfer happens in image-service: `post_images.imageUrl` is copied into `library_images.imageUrl` BEFORE the cascade deletes the `post_images` row. No window where the blob is unreferenced.

## Out of scope

- Undo / soft-delete. Future spec (§0 deferred).
- Bulk cancel ("cancel all remaining posts in a batch"). UI surfaces per-post only in Stage-2.
- Re-scheduling a cancelled post. The user re-opens the batch from `/create` (cancelled card) and re-runs the wizard.
- Updating `weekly_batches.status` when the last post in a batch is cancelled. Stage-2 leaves the batch in `scheduling`; the box shows 0 ✓ + 7 ✗ on the 7-day strip.
