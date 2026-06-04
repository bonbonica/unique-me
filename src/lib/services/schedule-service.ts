import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts, weeklyBatches } from "@/lib/schema";
import * as imageService from "./image-service";

/**
 * Stage-2 D-S2-2 / spec §5.4. The single entry point for committing a
 * `reviewing` batch into the rolling-4 `scheduling` slate.
 *
 * Concurrency model — read this BEFORE editing:
 *
 *   1. The status-guarded UPDATE (`set status='scheduling' where id=? and
 *      userId=? and status='reviewing'`) is the race authority. If 0 rows
 *      are affected the batch was already flipped by another tab or cron
 *      and we surface `not_reviewing` without touching state. This mirrors
 *      `postService.stopBatch`'s pattern (post-service.ts line ~1277).
 *
 *   2. The UPDATE + the count + the eviction-candidate read share ONE
 *      `db.transaction`. The inside-txn sentinel-error pattern
 *      (`throw new Error("__not_reviewing__")`) is the codebase's standard
 *      Drizzle idiom for surfacing a guarded-UPDATE miss as a typed result
 *      without smuggling a boolean flag out of the txn closure.
 *
 *   3. Blob `del()` calls run BETWEEN the two transactions, NEVER inside
 *      one. Network calls in an open txn pin a connection across remote
 *      I/O and risk pool exhaustion. The cost of stepping out of the txn
 *      is the partial-failure window documented below.
 *
 *   4. The eviction `DELETE` runs in its own short transaction so the
 *      cascade (posts → post_images → post_variations → post_selections →
 *      scheduled_posts) is atomic with the row removal.
 *
 * Failure semantics (spec §5.4 last paragraph, §7.7):
 *   - Step 1 UPDATE 0 rows → return `not_reviewing`; no state change.
 *   - Step 1 DB error → return `db_failed`; no state change.
 *   - Step 3 blob deletes fail → orphans logged inside image-service via
 *     `safeDeleteBlob`; we treat purge as best-effort and return
 *     `{ ok: true, evictedBatchId: null }`. Status flip stays committed.
 *   - Step 4 DELETE fails → status flip STILL stays committed (different
 *     txn). User now has 5 scheduled batches temporarily; the next
 *     `scheduleBatch` call (or manual cleanup) re-attempts eviction.
 *     Return `{ ok: true, evictedBatchId: null }` so the caller still
 *     sees the schedule action as successful.
 */

const ROLLING_CAP = 4;

export type ScheduleBatchResult =
  | { ok: true; batchId: string; evictedBatchId: string | null }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "not_reviewing" | "db_failed";
    };

// Sentinel string thrown from inside `db.transaction` to surface a
// guarded-UPDATE miss without a separate out-of-band flag. Matches the
// codebase's other Drizzle txn rollback idiom (see post-service.ts).
const NOT_REVIEWING_SENTINEL = "__not_reviewing__";

/**
 * Flip `weekly_batches.status` from `reviewing` to `scheduling` for
 * `batchId` (owned by `sessionUserId`) and, if the user now holds more
 * than {@link ROLLING_CAP} batches in `('scheduling', 'completed')`, evict
 * the oldest-by-`createdAt` batch (hard delete + image blob purge).
 *
 * Returns:
 *   - `{ ok: true, batchId, evictedBatchId }` where `evictedBatchId` is
 *     the id of the retired batch, or `null` when no eviction was needed.
 *   - `{ ok: false, error }` with one of:
 *       - `"not_found"` — no `weekly_batches` row with that id.
 *       - `"not_owned"` — row exists but belongs to another user.
 *       - `"not_reviewing"` — row's `status` is not `"reviewing"` (also
 *         used when the guarded UPDATE races and affects 0 rows).
 *       - `"db_failed"` — unexpected DB error during the flip txn.
 */
export async function scheduleBatch(
  sessionUserId: string,
  batchId: string,
): Promise<ScheduleBatchResult> {
  // 1. Cheap ownership + status pre-check. The guarded UPDATE is the real
  // race authority — this is just so we can return the precise `not_found`
  // / `not_owned` errors that the guarded UPDATE alone can't distinguish
  // from `not_reviewing`.
  const preCheckRows = await db
    .select({
      userId: weeklyBatches.userId,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  const batch = preCheckRows[0];
  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  if (batch.status !== "reviewing") {
    return { ok: false, error: "not_reviewing" };
  }

  // Collected inside the txn, drained after commit. Network calls (blob
  // deletes) MUST NOT happen inside an open db.transaction — see top-of-file.
  let evictionCandidateId: string | null = null;
  let evictionPostIds: string[] = [];

  // 2. Txn 1: status flip + count + eviction-candidate read.
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
        // Lost the race to another tab/cron. Bail out of the txn with the
        // sentinel — caught + translated to `not_reviewing` below.
        throw new Error(NOT_REVIEWING_SENTINEL);
      }

      // 3. Count after the flip is visible inside this txn. The just-flipped
      // batch IS counted (it's now `scheduling`), so the cap-breach threshold
      // is `> ROLLING_CAP` (i.e. >= 5).
      const countRows = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(weeklyBatches)
        .where(
          and(
            eq(weeklyBatches.userId, sessionUserId),
            inArray(weeklyBatches.status, ["scheduling", "completed"]),
          ),
        );
      // noUncheckedIndexedAccess: count(*) always returns one row, but TS
      // can't prove that. Default to 0 defensively (matches image-service).
      const count = countRows[0]?.count ?? 0;

      if (count > ROLLING_CAP) {
        // Find the oldest scheduling/completed batch for this user. The
        // just-flipped batch is the newest (it was the most recently
        // created `reviewing` row), so `asc(createdAt)` returns one of
        // the previous 4. The `oldest.id !== batchId` check below is
        // belt-and-braces for the millisecond-collision edge case.
        const oldestRows = await tx
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

        const oldest = oldestRows[0];
        if (oldest && oldest.id !== batchId) {
          evictionCandidateId = oldest.id;

          // Read the evicted batch's post IDs inside the same txn so a
          // concurrent insert can't add posts we'd then skip in step 3's
          // blob purge.
          const postRows = await tx
            .select({ id: posts.id })
            .from(posts)
            .where(eq(posts.batchId, oldest.id));
          evictionPostIds = postRows.map((r) => r.id);
        }
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === NOT_REVIEWING_SENTINEL) {
      return { ok: false, error: "not_reviewing" };
    }
    console.error("[scheduleService.scheduleBatch:flip]", err);
    return { ok: false, error: "db_failed" };
  }

  // No eviction needed — the common path. Return early.
  if (!evictionCandidateId) {
    return { ok: true, batchId, evictedBatchId: null };
  }

  // 3. Blob purge for the evicted batch's images. Runs BETWEEN the two
  // transactions on purpose. Failures inside `safeDeleteBlob` are
  // swallowed and logged to `post_logs.action='blob_orphan'`; an
  // `{ ok: false }` from `deleteImagesPermanently` here only happens on
  // an ownership mismatch (which we already screened for) so we treat it
  // as a logged anomaly and abandon eviction. Status flip stays committed.
  if (evictionPostIds.length > 0) {
    const purge = await imageService.deleteImagesPermanently(
      sessionUserId,
      evictionPostIds,
    );
    if (!purge.ok) {
      console.error(
        "[scheduleService.scheduleBatch:purge]",
        purge.error,
        evictionCandidateId,
      );
      return { ok: true, batchId, evictedBatchId: null };
    }
  }

  // 4. Txn 2: hard-delete the evicted batch row. Cascade cleans posts,
  // post_images, post_variations, post_selections, scheduled_posts.
  // Defense in depth: the WHERE clause re-includes `userId` so a stale
  // `evictionCandidateId` from a torn read can never delete another
  // user's row.
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
      // Lost a race — another path (concurrent scheduleBatch, or a future
      // cleanup job) already removed it. Idempotent: the user ends up at
      // the correct 4-batch state either way.
      return { ok: true, batchId, evictedBatchId: null };
    }

    return { ok: true, batchId, evictedBatchId: evictionCandidateId };
  } catch (err) {
    console.error("[scheduleService.scheduleBatch:evict]", err);
    // Status flip remains committed; user temporarily holds 5 scheduled
    // batches. The next scheduleBatch (or manual cleanup) retries the
    // eviction. Documented as self-healing in spec §7.7.
    return { ok: true, batchId, evictedBatchId: null };
  }
}
