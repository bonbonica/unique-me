import "server-only";

import { after } from "next/server";
import { del } from "@vercel/blob";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { generateImage } from "@/lib/ai/image-generator";
import { db } from "@/lib/db";
import {
  type LibraryImage,
  libraryImages,
  postImages,
  postLogs,
  posts,
} from "@/lib/schema";
import { upload } from "@/lib/storage";
import * as subscriptionService from "./subscription-service";

/**
 * Stage-2 D-S2-9. The single orchestrator for the Vercel Blob lifecycle. Every
 * deletion path in Stage-2 — per-post cancel, delete-batch-forever, rolling-4
 * eviction, library tile delete — routes through this module so the ordering
 * invariant is enforced in exactly one place:
 *
 *   1. SELECT the image_url (ownership-gated).
 *   2. Call blob `del()` via {@link safeDeleteBlob} — best-effort, never throws.
 *   3. Caller deletes the parent DB row (cascade cleans `post_images`).
 *
 * Library writes (`retainImagesToLibrary`) wrap the cap eviction + insert in a
 * single `db.transaction` guarded by `pg_advisory_xact_lock(hashtext('library:'
 * || userId))`, so the 30-image cap is race-safe under concurrent retains for
 * the same user. The lock auto-releases at txn commit. Blob deletes for evicted
 * library rows happen OUTSIDE the txn — issuing network calls inside an open
 * transaction risks holding row locks across slow remote work.
 *
 * Multi-user safety contract (locked, see spec §5.2): both
 * `retainImagesToLibrary` and `deleteImagesPermanently` reject the entire input
 * batch with `{ ok: false, error: "not_owned" }` if ANY `postId` resolves to a
 * `posts` row whose `userId !== sessionUserId`. A mixed-owner array is a caller
 * bug; silent filter-to-owned is forbidden. Asserted in task-18 (scenario 5e).
 */

const LIBRARY_CAP = 30;

export type ImageServiceResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" };

// =============================================================================
// Internal — best-effort blob deletion. NEVER throws.
// =============================================================================

/**
 * Tries to delete a Vercel Blob URL. On failure, logs a `post_logs` row with
 * `action='blob_orphan'` so the future soft-delete purge job can sweep
 * orphaned blobs. Both the `del()` and the log insert are best-effort — this
 * helper never throws, so callers never have to wrap it in try/catch.
 */
async function safeDeleteBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (err) {
    console.error("[imageService.safeDeleteBlob]", err);
    // Logging is best-effort too — never throw from cleanup. If the log
    // insert also fails (DB down, etc.), the original blob orphan is
    // unrecoverable here; the caller already has a real action to commit.
    await db
      .insert(postLogs)
      .values({
        action: "blob_orphan",
        details: {
          url,
          reason: err instanceof Error ? err.message : "unknown",
        },
      })
      .catch(() => {
        /* swallow */
      });
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Move every image attached to the given posts into the user's Image Library.
 *
 * - Ownership-gated: rejects the whole batch with `not_owned` if any `postId`
 *   resolves to another user's `posts` row.
 * - Cap eviction: if `existingLibraryCount + newImageCount > 30`, the oldest
 *   `library_images` rows by `createdAt` are evicted first. Their blobs are
 *   deleted via {@link safeDeleteBlob} AFTER the transaction commits.
 * - The library insert + cap eviction share one `db.transaction` guarded by a
 *   per-user `pg_advisory_xact_lock` so concurrent retains can't both observe
 *   `count=30` and both insert.
 *
 * Caller is responsible for deleting the parent `posts` (or `weekly_batches`)
 * row(s) afterwards — cascade then removes `post_images`. This helper does NOT
 * touch the parent rows.
 */
export async function retainImagesToLibrary(
  sessionUserId: string,
  postIds: string[],
): Promise<ImageServiceResult> {
  if (postIds.length === 0) return { ok: true };

  // 1. Read post_images for the given posts joined to posts for ownership.
  const imageRows = await db
    .select({
      postId: postImages.postId,
      batchId: posts.batchId,
      imageUrl: postImages.imageUrl,
      imagePrompt: postImages.imagePrompt,
      source: postImages.source,
      userId: posts.userId,
    })
    .from(postImages)
    .innerJoin(posts, eq(postImages.postId, posts.id))
    .where(inArray(postImages.postId, postIds));

  // No images attached to any of the input posts — still a success (the
  // caller's parent-row delete is the actual user-visible action).
  if (imageRows.length === 0) return { ok: true };

  // Multi-user safety: any row owned by another user fails the WHOLE batch.
  if (imageRows.some((r) => r.userId !== sessionUserId)) {
    return { ok: false, error: "not_owned" };
  }

  // Image-generation Wave 1: `post_images.imageUrl` is nullable. A NULL means
  // the image never reached `status = 'success'` (still pending / generating
  // / failed), so there's no blob to retain. Filter these rows out before we
  // size the eviction or insert into the library. Type predicate narrows the
  // downstream array so `library_images.imageUrl` (NOT NULL) receives a
  // string, not `string | null`.
  const retainable = imageRows.filter(
    (r): r is typeof r & { imageUrl: string } => r.imageUrl !== null,
  );
  if (retainable.length === 0) return { ok: true };

  // Collected during the txn, drained after commit so blob network calls
  // never happen inside an open transaction.
  const orphansToDelete: string[] = [];

  // 2. Acquire per-user advisory lock + run cap eviction + insert in one txn.
  await db.transaction(async (tx) => {
    // pg_advisory_xact_lock auto-releases at commit/rollback. The "library:"
    // namespace prefix keeps this lock distinct from any other per-user lock
    // we may add for unrelated resources. hashtext() returns int4 which
    // Postgres auto-widens to the bigint the advisory-lock function expects.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`library:${sessionUserId}`}))`,
    );

    const countRows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(libraryImages)
      .where(eq(libraryImages.userId, sessionUserId));
    // noUncheckedIndexedAccess: count(*) always returns one row, but TS
    // doesn't know that. Default to 0 defensively.
    const existingCount = countRows[0]?.count ?? 0;

    const overflow = existingCount + retainable.length - LIBRARY_CAP;

    if (overflow > 0) {
      const evictions = await tx
        .select({
          id: libraryImages.id,
          imageUrl: libraryImages.imageUrl,
        })
        .from(libraryImages)
        .where(eq(libraryImages.userId, sessionUserId))
        .orderBy(asc(libraryImages.createdAt))
        .limit(overflow);

      for (const row of evictions) orphansToDelete.push(row.imageUrl);

      if (evictions.length > 0) {
        await tx.delete(libraryImages).where(
          inArray(
            libraryImages.id,
            evictions.map((e) => e.id),
          ),
        );
      }
    }

    await tx.insert(libraryImages).values(
      retainable.map((r) => ({
        userId: sessionUserId,
        imageUrl: r.imageUrl,
        imagePrompt: r.imagePrompt,
        source: r.source,
        originPostId: r.postId,
        originBatchId: r.batchId,
      })),
    );
  });

  // 3. Blob deletes happen OUTSIDE the txn — see top-of-file rationale.
  // safeDeleteBlob never throws; failures are logged to post_logs.
  for (const url of orphansToDelete) await safeDeleteBlob(url);

  return { ok: true };
}

/**
 * Permanently delete every image attached to the given posts. No library
 * write, no advisory lock — just URL read (ownership-gated) + sequential
 * blob deletes. Used by rolling-4 eviction inside `scheduleService.scheduleBatch`.
 *
 * Caller is responsible for deleting the parent rows afterwards; cascade
 * cleans `post_images`.
 */
export async function deleteImagesPermanently(
  sessionUserId: string,
  postIds: string[],
): Promise<ImageServiceResult> {
  if (postIds.length === 0) return { ok: true };

  const imageRows = await db
    .select({
      imageUrl: postImages.imageUrl,
      userId: posts.userId,
    })
    .from(postImages)
    .innerJoin(posts, eq(postImages.postId, posts.id))
    .where(inArray(postImages.postId, postIds));

  if (imageRows.length === 0) return { ok: true };

  // Same multi-user safety contract as retainImagesToLibrary.
  if (imageRows.some((r) => r.userId !== sessionUserId)) {
    return { ok: false, error: "not_owned" };
  }

  // Image-generation Wave 1: skip rows whose `imageUrl` is NULL — those
  // never reached `status = 'success'`, so there's no blob to delete. The
  // `post_images` row will still be cascade-removed when the caller deletes
  // the parent post; this loop only handles the blob side.
  for (const row of imageRows) {
    if (row.imageUrl === null) continue;
    await safeDeleteBlob(row.imageUrl);
  }
  return { ok: true };
}

/**
 * Return the user's library_images rows newest-first. Used by the
 * `/library` page (D-S2-18).
 */
export async function listLibrary(
  sessionUserId: string,
): Promise<LibraryImage[]> {
  return db
    .select()
    .from(libraryImages)
    .where(eq(libraryImages.userId, sessionUserId))
    .orderBy(sql`${libraryImages.createdAt} desc`);
}

/**
 * Delete a single library image. Ownership check happens BEFORE the blob call
 * so we never call `del()` on another user's URL even by accident.
 *
 *  - `not_found` if no library_images row exists with that id.
 *  - `not_owned` if the row belongs to another user.
 *
 * Blob delete is best-effort via {@link safeDeleteBlob}; the row delete fires
 * unconditionally after, mirroring the URL-read-first / blob-then-row ordering.
 */
export async function deleteLibraryImage(
  sessionUserId: string,
  libraryImageId: string,
): Promise<ImageServiceResult> {
  const rows = await db
    .select({
      userId: libraryImages.userId,
      imageUrl: libraryImages.imageUrl,
    })
    .from(libraryImages)
    .where(eq(libraryImages.id, libraryImageId))
    .limit(1);

  // noUncheckedIndexedAccess: rows[0] is possibly undefined.
  const row = rows[0];
  if (!row) return { ok: false, error: "not_found" };
  if (row.userId !== sessionUserId) return { ok: false, error: "not_owned" };

  await safeDeleteBlob(row.imageUrl);

  await db
    .delete(libraryImages)
    .where(
      and(
        eq(libraryImages.id, libraryImageId),
        eq(libraryImages.userId, sessionUserId),
      ),
    );

  return { ok: true };
}

// ============================================================================
// Image-generation Wave 1 — runImageGenerationForBatch
// ============================================================================

/**
 * Cap on simultaneous OpenAI image-generation calls per batch run. Three is
 * a conservative starting point chosen to stay well under typical per-minute
 * rate limits for `gpt-image-1.5`. Tune downward (to 2 or 1) if production
 * logs show 429s; tune upward only after rate-limit headroom is verified.
 */
const IMAGE_CONCURRENCY = 3;

/**
 * Image-generation Wave 1 fan-out. Called from `postService.generateWeekly`
 * via `after()` from `next/server` AFTER the text-batch transaction has
 * committed — the response has already returned to the user. This function
 * drives the 7-9 OpenAI calls in parallel (bounded by `IMAGE_CONCURRENCY`)
 * and backfills each `post_images` row from `status="pending"` to either
 * `"success"` (with `imageUrl` set to the Vercel Blob URL) or `"failed"`.
 *
 * Contract:
 *  - **Never throws.** Top-level try/catch + per-row try/catch ensure that
 *    any exception is logged and converted to a `status="failed"` write.
 *    Throwing here would either crash the request handler (if not deferred)
 *    or be silently swallowed by `after()` (if it is) — neither is useful.
 *  - **Partial failure is fine.** One image failing flips that row to
 *    `failed`; the other 6-8 rows are unaffected. The batch is NEVER marked
 *    failed by an image error — `weekly_batches.status` stays whatever the
 *    text path set it to (`"reviewing"`).
 *  - **No auto-retry.** A `failed` row stays `failed` until Wave 2's manual
 *    retry control runs.
 *
 * Read shape: `post_images` has no direct `batchId`, so we inner-join `posts`
 * (which has `batchId`) to filter the pending rows for this batch.
 */
export async function runImageGenerationForBatch(
  batchId: string,
): Promise<void> {
  try {
    const pending = await db
      .select({
        id: postImages.id,
        imagePrompt: postImages.imagePrompt,
      })
      .from(postImages)
      .innerJoin(posts, eq(postImages.postId, posts.id))
      .where(
        and(eq(posts.batchId, batchId), eq(postImages.status, "pending")),
      );

    if (pending.length === 0) return;

    const limit = pLimit(IMAGE_CONCURRENCY);

    await Promise.allSettled(
      pending.map((row) =>
        limit(async () => {
          try {
            await db
              .update(postImages)
              .set({ status: "generating" })
              .where(eq(postImages.id, row.id));

            const result = await generateImage({
              combinedPrompt: row.imagePrompt,
            });

            if (!result) {
              await db
                .update(postImages)
                .set({ status: "failed" })
                .where(eq(postImages.id, row.id));
              return;
            }

            // Upload to Vercel Blob under `post-images/{batchId}/`. The row
            // id is the filename so collisions are impossible. Allow up to
            // 10MB per image — well above typical `gpt-image-1.5` PNG sizes
            // (usually 1-3MB at 1024x1024) but capped so a runaway response
            // can't drain Blob storage.
            const stored = await upload(
              result.imageBuffer,
              `${row.id}.png`,
              `post-images/${batchId}`,
              { maxSize: 10 * 1024 * 1024 },
            );

            await db
              .update(postImages)
              .set({ status: "success", imageUrl: stored.url })
              .where(eq(postImages.id, row.id));
          } catch (err) {
            // `generateImage` is never-throws by contract, but `upload` and
            // the `db.update` calls CAN throw (file-validation error, Blob
            // 5xx, DB connection drop). Catch here so the row doesn't get
            // stuck in `"generating"` and so `Promise.allSettled` sees a
            // clean resolution.
            console.error(
              "[image-service] runImageGenerationForBatch row failed",
              { rowId: row.id, err },
            );
            await db
              .update(postImages)
              .set({ status: "failed" })
              .where(eq(postImages.id, row.id))
              .catch((dbErr) => {
                console.error(
                  "[image-service] could not mark row failed after error",
                  { rowId: row.id, dbErr },
                );
              });
          }
        }),
      ),
    );
  } catch (err) {
    // If reading the pending rows fails entirely we can't do anything —
    // rows remain `pending`. Wave 2's retry control will recover them.
    console.error(
      "[image-service] runImageGenerationForBatch top-level failed",
      { batchId, err },
    );
  }
}

// ============================================================================
// Image-generation Wave 2 — single-row retry + regenerate
// ============================================================================

type RetryReason =
  | "not_owned"
  | "not_failed"
  | "attempts_exhausted"
  | "already_in_progress";

type RegenerateReason =
  | "not_owned"
  | "not_successful"
  | "attempts_exhausted"
  | "already_in_progress"
  | "pro_required";

export type RetryImageResult =
  | { ok: true }
  | { ok: false; reason: RetryReason };

export type RegenerateImageResult =
  | { ok: true }
  | { ok: false; reason: RegenerateReason };

/**
 * Wave 2 single-row analog of {@link runImageGenerationForBatch}. Drives one
 * `post_images` row through the OpenAI → Blob → DB lifecycle. Called from
 * {@link retryImage} / {@link regenerateImage} via `after()` from `next/server`
 * so the user's HTTP response returns before the OpenAI call starts.
 *
 * Mode dispatch only differs on the failure path:
 *  - `mode="retry"`: failure → `status="failed"`. Attempt is already at 2, so
 *    the tile will render the exhausted "Couldn't generate this image."
 *    message after the next poll tick.
 *  - `mode="regenerate"`: failure → `status="success"` and `imageUrl` is left
 *    UNTOUCHED. The original image survives. The polling client compares the
 *    pre-regenerate URL snapshot against the post-regenerate URL and fires
 *    the "kept original" toast when they match.
 *
 * Never throws. Single row → no `pLimit` (the batch fan-out caps OpenAI
 * concurrency; a single-row click can't outrun anything).
 *
 * Blob lifecycle note: on regenerate-success the previous `imageUrl` is
 * orphaned (the row now points at the new blob). Blob cleanup is Wave 3
 * scope per `specs/wave-2-image-retry/spec.md` §Out of scope.
 */
export async function runImageGenerationForRow(
  postImageId: string,
  mode: "retry" | "regenerate",
): Promise<void> {
  try {
    const rows = await db
      .select({
        id: postImages.id,
        imagePrompt: postImages.imagePrompt,
        batchId: posts.batchId,
      })
      .from(postImages)
      .innerJoin(posts, eq(postImages.postId, posts.id))
      .where(eq(postImages.id, postImageId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      console.error(
        "[image-service] runImageGenerationForRow: row not found",
        { postImageId, mode },
      );
      return;
    }

    const result = await generateImage({ combinedPrompt: row.imagePrompt });

    if (!result) {
      await db
        .update(postImages)
        .set({ status: mode === "retry" ? "failed" : "success" })
        .where(eq(postImages.id, row.id))
        .catch((dbErr) => {
          console.error(
            "[image-service] could not mark row terminal after generate null",
            { rowId: row.id, mode, dbErr },
          );
        });
      return;
    }

    const stored = await upload(
      result.imageBuffer,
      `${row.id}.png`,
      `post-images/${row.batchId}`,
      { maxSize: 10 * 1024 * 1024 },
    );

    await db
      .update(postImages)
      .set({ status: "success", imageUrl: stored.url })
      .where(eq(postImages.id, row.id));
  } catch (err) {
    console.error("[image-service] runImageGenerationForRow failed", {
      postImageId,
      mode,
      err,
    });
    // Best-effort terminal recovery so the row doesn't stick in
    // generating/regenerating. retry → failed; regenerate → success
    // (imageUrl unchanged). If this also throws the row stays in its
    // in-flight status until a future reaper job (out of scope for Wave 2).
    await db
      .update(postImages)
      .set({ status: mode === "retry" ? "failed" : "success" })
      .where(eq(postImages.id, postImageId))
      .catch((dbErr) => {
        console.error(
          "[image-service] terminal recovery write also failed",
          { postImageId, mode, dbErr },
        );
      });
  }
}

/**
 * Manually retry image generation for a single FAILED row. All tiers.
 *
 * Atomic conditional UPDATE — only matches when the row is owned, status is
 * "failed", and attempt is 1. Two simultaneous clicks: one wins, the other's
 * UPDATE matches 0 rows and resolves to `reason: "already_in_progress"` via
 * the post-fail re-SELECT.
 *
 * Schedules {@link runImageGenerationForRow} via `after()` so the caller's
 * server-action response returns immediately.
 */
export async function retryImage(
  postImageId: string,
  sessionUserId: string,
): Promise<RetryImageResult> {
  const updated = await db
    .update(postImages)
    .set({ status: "generating", attempt: 2 })
    .where(
      and(
        eq(postImages.id, postImageId),
        eq(postImages.userId, sessionUserId),
        eq(postImages.status, "failed"),
        eq(postImages.attempt, 1),
      ),
    )
    .returning({ id: postImages.id });

  if (updated.length === 0) {
    return {
      ok: false,
      reason: await mapRetryFailureReason(postImageId, sessionUserId),
    };
  }

  after(() => runImageGenerationForRow(postImageId, "retry"));
  return { ok: true };
}

/**
 * Manually replace a successful image with a new attempt. Pro + active only.
 *
 * Tier gate runs BEFORE any DB write (cheap rejection for non-Pro). On
 * success the conditional UPDATE flips status to "regenerating" while
 * leaving `imageUrl` intact — the UI keeps showing the original (dimmed)
 * until attempt 2 lands. Regenerate-failure inside
 * {@link runImageGenerationForRow} reverts status to "success" without
 * touching `imageUrl`, so the user never loses good content.
 */
export async function regenerateImage(
  postImageId: string,
  sessionUserId: string,
): Promise<RegenerateImageResult> {
  const sub = await subscriptionService.checkSubscription(sessionUserId);
  if (!(sub.plan === "pro" && sub.status === "active")) {
    return { ok: false, reason: "pro_required" };
  }

  const updated = await db
    .update(postImages)
    .set({ status: "regenerating", attempt: 2 })
    .where(
      and(
        eq(postImages.id, postImageId),
        eq(postImages.userId, sessionUserId),
        eq(postImages.status, "success"),
        eq(postImages.attempt, 1),
      ),
    )
    .returning({ id: postImages.id });

  if (updated.length === 0) {
    return {
      ok: false,
      reason: await mapRegenerateFailureReason(postImageId, sessionUserId),
    };
  }

  after(() => runImageGenerationForRow(postImageId, "regenerate"));
  return { ok: true };
}

/**
 * Re-SELECT the row after a failed conditional UPDATE in {@link retryImage}
 * to determine which precondition the caller violated. "Row missing" and
 * "wrong owner" both map to `not_owned` so existence isn't leaked. In-flight
 * status takes precedence over the attempt cap so a user who double-clicks
 * sees "already retrying" rather than the misleading "no more attempts".
 */
async function mapRetryFailureReason(
  postImageId: string,
  sessionUserId: string,
): Promise<RetryReason> {
  const rows = await db
    .select({
      userId: postImages.userId,
      status: postImages.status,
      attempt: postImages.attempt,
    })
    .from(postImages)
    .where(eq(postImages.id, postImageId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== sessionUserId) return "not_owned";
  if (row.status === "generating" || row.status === "regenerating") {
    return "already_in_progress";
  }
  if (row.attempt >= 2) return "attempts_exhausted";
  return "not_failed";
}

/** Sibling of {@link mapRetryFailureReason} for the regenerate flow. */
async function mapRegenerateFailureReason(
  postImageId: string,
  sessionUserId: string,
): Promise<Exclude<RegenerateReason, "pro_required">> {
  const rows = await db
    .select({
      userId: postImages.userId,
      status: postImages.status,
      attempt: postImages.attempt,
    })
    .from(postImages)
    .where(eq(postImages.id, postImageId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== sessionUserId) return "not_owned";
  if (row.status === "generating" || row.status === "regenerating") {
    return "already_in_progress";
  }
  if (row.attempt >= 2) return "attempts_exhausted";
  return "not_successful";
}
