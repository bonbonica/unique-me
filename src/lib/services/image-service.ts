import "server-only";

import { after } from "next/server";
import { del } from "@vercel/blob";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { generateImage } from "@/lib/ai/image-generator";
import { db } from "@/lib/db";
import {
  type LibraryImage,
  libraryImages,
  postImages,
  postLogs,
  posts,
  profiles,
  scheduledPosts,
  weeklyBatches,
} from "@/lib/schema";
import { upload } from "@/lib/storage";
import * as subscriptionService from "./subscription-service";

// ============================================================================
// User-uploaded image config — used by `uploadImageForPost`. The canonical
// upload pipeline resizes every input to a single 1080×1080 JPEG so the
// downstream renderer + future posting worker don't have to deal with
// variable dimensions or formats. Matches the AI-generated image's
// roughly-square aspect today.
// ============================================================================

const UPLOAD_CANONICAL_SIZE = 1080;
const UPLOAD_OUTPUT_QUALITY = 88;
const UPLOAD_MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOAD_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export type UploadImageResult =
  | { ok: true; imageUrl: string }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_owned"
        | "too_large"
        | "bad_mime"
        | "processing_failed"
        | "db_failed";
    };

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

// Wave 3 image library: raised from 30 → 100. The cap is no longer enforced
// by silent eviction at insert time (`retainImagesToLibrary`); enforcement
// moved to `runMonthlyCleanup`, which fires on the user's first app open of
// a new calendar month and respects locks + in-use protection. The library
// can briefly exceed 100 between cleanups — intentional.
//
// Exported so Stage 2's `runMonthlyCleanup` and Stage 4's `count/N` pill
// share a single source of truth (changing the cap is one diff).
export const LIBRARY_CAP = 100;

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
 * - Filters out rows whose `post_images.imageUrl` is NULL (Wave 1 nullable
 *   column — only successful images carry a URL worth retaining).
 * - Insert runs inside a `db.transaction` guarded by a per-user
 *   `pg_advisory_xact_lock` so concurrent retains from multi-device sessions
 *   don't race on the future `lockedAt` / `lastUsedAt` columns.
 *
 * **Wave 3 behavior change:** this function no longer evicts oldest rows when
 * the user is over `LIBRARY_CAP`. Cap enforcement moved to
 * {@link runMonthlyCleanup}, which fires on the first app open of a new
 * calendar month and respects locks + in-use protection. The library can
 * briefly exceed 100 between cleanups — intentional, matches the spec's
 * "user-aware monthly cleanup" model.
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
  // insert into the library. Type predicate narrows the downstream array so
  // `library_images.imageUrl` (NOT NULL) receives a string, not `string | null`.
  const retainable = imageRows.filter(
    (r): r is typeof r & { imageUrl: string } => r.imageUrl !== null,
  );
  if (retainable.length === 0) return { ok: true };

  // 2. Acquire per-user advisory lock + insert in one txn. No eviction —
  //    cap enforcement is `runMonthlyCleanup`'s job (Wave 3 spec).
  await db.transaction(async (tx) => {
    // pg_advisory_xact_lock auto-releases at commit/rollback. The "library:"
    // namespace prefix keeps this lock distinct from any other per-user lock
    // we may add for unrelated resources. hashtext() returns int4 which
    // Postgres auto-widens to the bigint the advisory-lock function expects.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`library:${sessionUserId}`}))`,
    );

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
  console.warn("[image-service] runImageGenerationForRow start", {
    postImageId,
    mode,
  });
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

    console.warn("[image-service] runImageGenerationForRow row loaded", {
      postImageId,
      batchId: row.batchId,
      promptLen: row.imagePrompt.length,
      mode,
    });

    const result = await generateImage({ combinedPrompt: row.imagePrompt });

    if (!result) {
      const terminalStatus = mode === "retry" ? "failed" : "success";
      console.warn(
        "[image-service] runImageGenerationForRow generateImage returned null; reverting",
        { postImageId, mode, terminalStatus },
      );
      await db
        .update(postImages)
        .set({ status: terminalStatus })
        .where(eq(postImages.id, row.id))
        .catch((dbErr) => {
          console.error(
            "[image-service] could not mark row terminal after generate null",
            { rowId: row.id, mode, dbErr },
          );
        });
      return;
    }

    console.warn("[image-service] runImageGenerationForRow uploading", {
      postImageId,
      bytes: result.imageBuffer.byteLength,
      mode,
      allowOverwrite: mode === "regenerate",
    });

    let stored;
    try {
      stored = await upload(
        result.imageBuffer,
        `${row.id}.png`,
        `post-images/${row.batchId}`,
        {
          maxSize: 10 * 1024 * 1024,
          // Regenerate writes a second blob for the same logical post_images
          // row; Vercel Blob rejects the duplicate pathname unless we allow
          // an overwrite. Retry keeps the default (no overwrite) because
          // attempt 1 already failed (no blob exists) so there's nothing to
          // collide with. Overwriting also keeps the URL stable, so the row's
          // `imageUrl` continues to point at the same Blob path.
          allowOverwrite: mode === "regenerate",
        },
      );
    } catch (uploadErr) {
      // Surface upload-specific failures distinctly from the OpenAI-side
      // generateImage path. Blob errors usually carry `name` / `message`
      // plus optional `status` / `cause` — log all four flat.
      const e = uploadErr as { name?: string; message?: string; status?: number; cause?: unknown };
      console.error("[image-service] runImageGenerationForRow upload failed", {
        postImageId,
        mode,
        allowOverwrite: mode === "regenerate",
        name: uploadErr instanceof Error ? uploadErr.name : typeof uploadErr,
        message: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
        status: e.status,
        cause: e.cause,
      });
      throw uploadErr;
    }

    console.warn("[image-service] runImageGenerationForRow upload ok", {
      postImageId,
      url: stored.url,
      mode,
    });

    await db
      .update(postImages)
      .set({ status: "success", imageUrl: stored.url })
      .where(eq(postImages.id, row.id));

    console.warn("[image-service] runImageGenerationForRow complete", {
      postImageId,
      mode,
    });
  } catch (err) {
    const e = err as { name?: string; message?: string; status?: number; cause?: unknown };
    console.error("[image-service] runImageGenerationForRow failed", {
      postImageId,
      mode,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      status: e.status,
      cause: e.cause,
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
 * Manually replace a successful image with a new attempt. Gated to users
 * with Pro-tier feature access — active Pro or active (non-expired) trial.
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
  console.warn("[image-service] regenerateImage call", {
    postImageId,
    userId: sessionUserId,
  });

  const sub = await subscriptionService.checkSubscription(sessionUserId);
  if (!subscriptionService.hasProFeatures(sub)) {
    console.warn("[image-service] regenerateImage blocked: pro_required", {
      postImageId,
      userId: sessionUserId,
      plan: sub.plan,
      status: sub.status,
    });
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
    const reason = await mapRegenerateFailureReason(postImageId, sessionUserId);
    console.warn(
      "[image-service] regenerateImage blocked: gate UPDATE matched 0 rows",
      { postImageId, userId: sessionUserId, reason },
    );
    return { ok: false, reason };
  }

  console.warn("[image-service] regenerateImage scheduling worker", {
    postImageId,
  });
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

// ============================================================================
// Image library Wave 3 — monthly cleanup, lock toggle, bulk delete,
// post-publish blob lifecycle, picker stub.
//
// Cap = LIBRARY_CAP (100). Enforced ONLY by runMonthlyCleanup, which fires
// on the user's first app open of a new calendar month (string compare on
// `profiles.last_cleanup_check_month`). Locked + in-use rows are exempt.
// ============================================================================

/**
 * Batch statuses that mean a library image is still "in use" — its
 * `originPostId` resolves to a post in one of these batches and so should
 * NOT be cleaned up. Sourced from BatchStatus in schema.ts. `"completed"`
 * and `"in_progress"` are deliberately excluded: a completed batch has
 * already posted (and the post-publish hook may have cleared the
 * `post_images` reference); `"in_progress"` is unreachable in current code.
 */
const ACTIVE_BATCH_STATUSES = [
  "reviewing",
  "scheduling",
  "scheduled",
  "cancelled",
] as const;

export type CleanupResult =
  | { ok: true; action: "none" | "ran"; deleted: number; over: number }
  | { ok: false; error: "unauthenticated" };

export type InspectCleanupResult = {
  cleanupNeeded: boolean;
  shouldShowReminder: boolean;
  count: number;
  over: number;
};

export type PickFromLibraryResult =
  | { ok: true; imageUrl: string }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_owned"
        | "library_image_not_found"
        | "db_failed";
    };

/**
 * Pure read — returns the state the onboarded layout needs to decide
 * "show modal", "run silently", or "nothing to do". Does NOT mutate
 * `lastCleanupCheckMonth`; only `runMonthlyCleanup` does that.
 *
 * Resolution:
 *  - Already checked this month → `cleanupNeeded: false`.
 *  - Over cap, reminder dismissed → `cleanupNeeded: true, shouldShowReminder: false`.
 *  - Over cap, reminder not dismissed → both true.
 *  - Under or at cap → `cleanupNeeded: false`.
 */
export async function inspectMonthlyCleanupState(
  sessionUserId: string,
  currentMonthYyyyMm: string,
): Promise<InspectCleanupResult> {
  const profileRows = await db
    .select({
      lastCleanupCheckMonth: profiles.lastCleanupCheckMonth,
      dismissed: profiles.monthlyCleanupReminderDismissed,
    })
    .from(profiles)
    .where(eq(profiles.userId, sessionUserId))
    .limit(1);

  const profile = profileRows[0];
  // No profile = unboarded path; nothing to clean.
  if (!profile) {
    return { cleanupNeeded: false, shouldShowReminder: false, count: 0, over: 0 };
  }

  if (profile.lastCleanupCheckMonth === currentMonthYyyyMm) {
    return { cleanupNeeded: false, shouldShowReminder: false, count: 0, over: 0 };
  }

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(libraryImages)
    .where(eq(libraryImages.userId, sessionUserId));
  const count = countRows[0]?.count ?? 0;
  const over = Math.max(0, count - LIBRARY_CAP);

  const cleanupNeeded = over > 0;
  const shouldShowReminder = cleanupNeeded && !profile.dismissed;

  return { cleanupNeeded, shouldShowReminder, count, over };
}

/**
 * One-way dismiss of the cleanup reminder. After this call, future
 * `inspectMonthlyCleanupState` results have `shouldShowReminder: false` and
 * the onboarded layout runs cleanup silently. Wave 3 has no Settings toggle
 * to re-enable; that's future work.
 */
export async function markCleanupReminderDismissed(
  sessionUserId: string,
): Promise<void> {
  await db
    .update(profiles)
    .set({ monthlyCleanupReminderDismissed: true })
    .where(eq(profiles.userId, sessionUserId));
}

/**
 * Wave 3 monthly cleanup. Idempotent within a calendar month — second call
 * the same month is a no-op via `lastCleanupCheckMonth` string equality.
 *
 * Algorithm:
 *  1. Already checked this month → return `{action: "none"}`.
 *  2. Under cap → set `lastCleanupCheckMonth` and return `{action: "none"}`.
 *  3. Over cap → SELECT unlocked + unused rows oldest first by
 *     `COALESCE(lastUsedAt, createdAt)`, delete up to `over` of them. For
 *     each: `safeDeleteBlob` (best-effort, never throws) then DB DELETE.
 *  4. Update `lastCleanupCheckMonth` even if 0 rows were actually deletable
 *     (all over-cap rows could be locked or in-use). User can manually
 *     unlock and revisit next month.
 *
 * "In use" is defined as: the row's `originPostId` resolves to a `posts`
 * row whose batch is in {@link ACTIVE_BATCH_STATUSES}. Library rows whose
 * origin post no longer exists (deleted) are NOT in use → eligible. The
 * spec is conservative on purpose; once Wave 4's picker ships and writes
 * `lastUsedAt`, recently-reused images naturally survive cleanup via the
 * COALESCE sort.
 *
 * Never throws. Returns the actual deleted count and the original overage
 * so the UI can render a sensible toast ("Removed N of M unlocked images").
 */
export async function runMonthlyCleanup(
  sessionUserId: string,
  currentMonthYyyyMm: string,
): Promise<CleanupResult> {
  try {
    const profileRows = await db
      .select({ lastCleanupCheckMonth: profiles.lastCleanupCheckMonth })
      .from(profiles)
      .where(eq(profiles.userId, sessionUserId))
      .limit(1);
    const profile = profileRows[0];
    if (!profile) {
      return { ok: true, action: "none", deleted: 0, over: 0 };
    }
    if (profile.lastCleanupCheckMonth === currentMonthYyyyMm) {
      return { ok: true, action: "none", deleted: 0, over: 0 };
    }

    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(libraryImages)
      .where(eq(libraryImages.userId, sessionUserId));
    const count = countRows[0]?.count ?? 0;
    const over = Math.max(0, count - LIBRARY_CAP);

    if (over === 0) {
      await db
        .update(profiles)
        .set({ lastCleanupCheckMonth: currentMonthYyyyMm })
        .where(eq(profiles.userId, sessionUserId));
      return { ok: true, action: "none", deleted: 0, over: 0 };
    }

    // Collect every postId currently in an active batch for this user.
    // Library rows whose originPostId is in this set are "in use".
    // Read-once + JS filter is simpler than a Drizzle NOT EXISTS subquery
    // and fast enough at typical library sizes (~100 rows, few active batches).
    const activePostIds = await db
      .selectDistinct({ id: posts.id })
      .from(posts)
      .innerJoin(weeklyBatches, eq(posts.batchId, weeklyBatches.id))
      .where(
        and(
          eq(weeklyBatches.userId, sessionUserId),
          inArray(
            weeklyBatches.status,
            ACTIVE_BATCH_STATUSES as unknown as string[],
          ),
        ),
      );
    const inUseSet = new Set(activePostIds.map((r) => r.id));

    const candidates = await db
      .select({
        id: libraryImages.id,
        imageUrl: libraryImages.imageUrl,
        originPostId: libraryImages.originPostId,
      })
      .from(libraryImages)
      .where(
        and(
          eq(libraryImages.userId, sessionUserId),
          isNull(libraryImages.lockedAt),
        ),
      )
      .orderBy(
        asc(
          sql`COALESCE(${libraryImages.lastUsedAt}, ${libraryImages.createdAt})`,
        ),
      );

    const eligible = candidates.filter(
      (r) => !r.originPostId || !inUseSet.has(r.originPostId),
    );
    const toDelete = eligible.slice(0, over);

    let deleted = 0;
    for (const row of toDelete) {
      await safeDeleteBlob(row.imageUrl);
      const result = await db
        .delete(libraryImages)
        .where(
          and(
            eq(libraryImages.id, row.id),
            eq(libraryImages.userId, sessionUserId),
          ),
        )
        .returning({ id: libraryImages.id });
      deleted += result.length;
    }

    await db
      .update(profiles)
      .set({ lastCleanupCheckMonth: currentMonthYyyyMm })
      .where(eq(profiles.userId, sessionUserId));

    return { ok: true, action: "ran", deleted, over };
  } catch (err) {
    console.error("[image-service] runMonthlyCleanup top-level failed", {
      sessionUserId,
      currentMonthYyyyMm,
      err,
    });
    // Return a benign "none" — UI shows no toast, user can retry next visit.
    return { ok: true, action: "none", deleted: 0, over: 0 };
  }
}

/**
 * Toggle the padlock on a single library image. `lock=true` sets `lockedAt`
 * to now (protected from cleanup); `lock=false` clears it. Ownership-gated
 * via the WHERE clause — wrong owner returns `not_found` (same as missing
 * row, so existence isn't leaked).
 */
export async function toggleLibraryImageLock(
  sessionUserId: string,
  libraryImageId: string,
  lock: boolean,
): Promise<ImageServiceResult> {
  const updated = await db
    .update(libraryImages)
    .set({ lockedAt: lock ? new Date() : null })
    .where(
      and(
        eq(libraryImages.id, libraryImageId),
        eq(libraryImages.userId, sessionUserId),
      ),
    )
    .returning({ id: libraryImages.id });

  if (updated.length === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}

/**
 * Bulk-delete library images for this user.
 *  - `"unlocked-only"`: deletes only rows where `lockedAt IS NULL`. Used by
 *    the "Delete all" button (respects locks).
 *  - `"all"`: ignores lock state. Used by the post-download popup option
 *    "Delete all images (incl. locked)" — explicit destructive choice.
 *
 * Same blob-then-row ordering as `deleteLibraryImage`: read URLs, fire
 * `safeDeleteBlob` per row (best-effort), then DELETE the rows. Sequential
 * blob deletes mirror the existing pattern — fine at typical library sizes;
 * future work can parallelise if needed.
 */
export async function deleteAllLibraryImages(
  sessionUserId: string,
  mode: "unlocked-only" | "all",
): Promise<{ ok: true; deleted: number }> {
  const where =
    mode === "unlocked-only"
      ? and(
          eq(libraryImages.userId, sessionUserId),
          isNull(libraryImages.lockedAt),
        )
      : eq(libraryImages.userId, sessionUserId);

  const rows = await db
    .select({ id: libraryImages.id, imageUrl: libraryImages.imageUrl })
    .from(libraryImages)
    .where(where);

  if (rows.length === 0) return { ok: true, deleted: 0 };

  for (const row of rows) await safeDeleteBlob(row.imageUrl);

  await db.delete(libraryImages).where(
    inArray(
      libraryImages.id,
      rows.map((r) => r.id),
    ),
  );

  return { ok: true, deleted: rows.length };
}

/**
 * Contract for the future posting service. Called after each
 * `scheduledPosts.status` transition to `"posted"`. If EVERY platform for
 * this post has posted, the image blob is reclaimed and the post_images
 * pointer is cleared.
 *
 * Source-aware blob disposal:
 *  - `"ai"` / `"uploaded"`: the blob belongs to this post alone → delete.
 *  - `"library"`: the blob is owned by `library_images` → do NOT delete;
 *    only clear the post_images pointer.
 *
 * Never throws. Wave 3 ships the function; no caller exists in current
 * code (posting cron is Phase 4+). When the posting service is built it
 * calls this after marking each scheduledPost row as `"posted"`.
 */
export async function deleteImageIfAllPlatformsPosted(
  postId: string,
): Promise<void> {
  try {
    const schedRows = await db
      .select({ status: scheduledPosts.status })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.postId, postId));

    if (schedRows.length === 0) return;
    if (schedRows.some((r) => r.status !== "posted")) return;

    const imgRows = await db
      .select({
        id: postImages.id,
        imageUrl: postImages.imageUrl,
        source: postImages.source,
        publishedAt: postImages.publishedAt,
      })
      .from(postImages)
      .where(eq(postImages.postId, postId))
      .limit(1);

    const img = imgRows[0];
    if (!img) return;
    if (img.imageUrl === null || img.publishedAt !== null) return;

    if (img.source === "ai" || img.source === "uploaded") {
      await safeDeleteBlob(img.imageUrl);
    }
    // source === "library": library_images still owns the blob, leave it.

    await db
      .update(postImages)
      .set({ imageUrl: null, publishedAt: new Date() })
      .where(eq(postImages.id, img.id));
  } catch (err) {
    console.error("[image-service] deleteImageIfAllPlatformsPosted failed", {
      postId,
      err,
    });
  }
}

// ============================================================================
// Upload-your-own-image — `uploadImageForPost` + `pickFromLibraryForPost`.
//
// Both replace the post's current image (an AI image, a previous upload,
// or a library reference) with the new one. The current image — if any —
// is retained to the library first so the user never silently loses an
// image they might want back.
//
// Upload: TWO blob uploads happen — one to `post-images/{batchId}` and
// one to `library-images/{userId}`. The two URLs are independent, so
// deleting the library copy never breaks the post copy. Costs one extra
// Vercel Blob write per upload; bulletproof against the orphan-blob bug.
//
// Library-pick: REFERENCES the library blob URL (no copy). The library's
// cleanup logic protects in-use rows via `lastUsedAt`, which this
// function bumps. If the user manually deletes the library image, the
// post 404s — known trade-off, accepted for v1.
// ============================================================================

/**
 * Source-aware cleanup of a post's CURRENT image. Used by both
 * `uploadImageForPost` and `pickFromLibraryForPost` before they swap
 * in the new one.
 *
 * The cleanup branches on `post_images.source`:
 *   - **`"ai"`** — the AI-generated image is discarded. Blob is deleted
 *     via `safeDeleteBlob`. The `post_images` row itself is deleted by
 *     the caller's transaction. No library retention — the user
 *     explicitly doesn't want auto-generated images cluttering their
 *     library.
 *   - **`"uploaded"`** — the user worked to upload this image; retain
 *     it to the library so they can get it back. Reuses
 *     `retainImagesToLibrary` to copy the URL into `library_images`;
 *     the blob stays alive (now referenced by the library row). The
 *     caller's transaction deletes the post_images row.
 *   - **`"library"`** — the post merely references a library blob;
 *     the library still owns it. Skip both retention and blob delete.
 *     The caller's transaction deletes the post_images row only.
 *
 * No-op (returns ok) when the post has no successful image yet
 * (`imageUrl IS NULL`).
 */
async function cleanupPriorPostImage(
  sessionUserId: string,
  postId: string,
): Promise<ImageServiceResult> {
  const [prior] = await db
    .select({
      imageUrl: postImages.imageUrl,
      source: postImages.source,
    })
    .from(postImages)
    .where(eq(postImages.postId, postId))
    .limit(1);

  if (!prior || prior.imageUrl === null) {
    return { ok: true };
  }

  if (prior.source === "uploaded") {
    return retainImagesToLibrary(sessionUserId, [postId]);
  }

  if (prior.source === "ai") {
    await safeDeleteBlob(prior.imageUrl);
    return { ok: true };
  }

  // source === "library": post just referenced the library's blob;
  // library still owns it. Nothing to retain, nothing to delete here.
  return { ok: true };
}

/**
 * Replace the post's image with a user-uploaded one. Validates size +
 * mime, resizes via `sharp` to a canonical 1080×1080 JPEG, writes two
 * blobs (post + library), source-aware-cleans the prior image (see
 * {@link cleanupPriorPostImage}), and swaps the `post_images` row in a
 * single transaction.
 */
export async function uploadImageForPost(
  sessionUserId: string,
  postId: string,
  rawBuffer: Buffer,
  mimeType: string,
): Promise<UploadImageResult> {
  // 1. Cheap input validation BEFORE any expensive work (sharp / blob).
  if (!UPLOAD_ALLOWED_MIME.has(mimeType)) {
    return { ok: false, error: "bad_mime" };
  }
  if (rawBuffer.length > UPLOAD_MAX_INPUT_BYTES) {
    return { ok: false, error: "too_large" };
  }

  // 2. Ownership + batch lookup.
  const [row] = await db
    .select({
      userId: posts.userId,
      batchId: posts.batchId,
      batchDeletedAt: weeklyBatches.deletedAt,
    })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!row || row.batchDeletedAt !== null) {
    return { ok: false, error: "not_found" };
  }
  if (row.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }

  // 3. Resize + normalize to a canonical 1080×1080 JPEG via sharp.
  //    `fit: cover` center-crops to square; quality 88 keeps file size
  //    reasonable without visible artefacts at this resolution. Failures
  //    surface as `processing_failed` (corrupt image, unsupported format
  //    that slipped the mime check, etc.).
  // Lazy-load sharp so its native binding only resolves when an upload
  // actually runs. Top-level import would force every Lambda that bundles
  // this module (auth, dashboard, marketing) to dlopen libvips at cold
  // start — and any sharp install regression on Vercel would cascade into
  // 500s on routes that have nothing to do with images.
  let processed: Buffer;
  try {
    const { default: sharp } = await import("sharp");
    processed = await sharp(rawBuffer)
      .resize(UPLOAD_CANONICAL_SIZE, UPLOAD_CANONICAL_SIZE, { fit: "cover" })
      .jpeg({ quality: UPLOAD_OUTPUT_QUALITY })
      .toBuffer();
  } catch (err) {
    console.error("[imageService.uploadImageForPost] sharp failed", err);
    return { ok: false, error: "processing_failed" };
  }

  // 4. Two independent blob uploads — post copy and library copy never
  //    share a URL, so deleting from the library can never break the
  //    post image. Same buffer, two different paths.
  let postBlobUrl: string;
  let libraryBlobUrl: string;
  try {
    const postBlob = await upload(
      processed,
      `${crypto.randomUUID()}.jpg`,
      `post-images/${row.batchId}`,
      { maxSize: UPLOAD_MAX_INPUT_BYTES * 2 },
    );
    const libraryBlob = await upload(
      processed,
      `${crypto.randomUUID()}.jpg`,
      `library-images/${sessionUserId}`,
      { maxSize: UPLOAD_MAX_INPUT_BYTES * 2 },
    );
    postBlobUrl = postBlob.url;
    libraryBlobUrl = libraryBlob.url;
  } catch (err) {
    console.error("[imageService.uploadImageForPost] blob upload failed", err);
    return { ok: false, error: "processing_failed" };
  }

  // 5. Source-aware cleanup of the prior image (if any) BEFORE we drop
  //    its row. The user explicitly only wants user-uploaded prior
  //    images retained to the library — AI images are discarded, and
  //    library-sourced posts release the row without touching the
  //    blob (which the library still owns).
  const cleanup = await cleanupPriorPostImage(sessionUserId, postId);
  if (!cleanup.ok) {
    // Retention failure is the only path that surfaces an error here.
    // Caller can retry; the new blobs we just uploaded become orphans
    // until a future cleanup job sweeps them (acceptable trade-off —
    // Vercel Blob retention is cheap).
    console.error(
      "[imageService.uploadImageForPost] prior-image cleanup failed",
      cleanup,
    );
    return { ok: false, error: "db_failed" };
  }

  // 6. Swap the post_images row and create the library_images row in
  //    one transaction.
  try {
    await db.transaction(async (tx) => {
      await tx.delete(postImages).where(eq(postImages.postId, postId));
      await tx.insert(postImages).values({
        postId,
        userId: sessionUserId,
        imageUrl: postBlobUrl,
        imagePrompt: "User upload",
        source: "uploaded",
        status: "success",
        attempt: 1,
      });
      await tx.insert(libraryImages).values({
        userId: sessionUserId,
        imageUrl: libraryBlobUrl,
        imagePrompt: "User upload",
        source: "uploaded",
        originPostId: postId,
        originBatchId: row.batchId,
      });
    });
  } catch (err) {
    console.error("[imageService.uploadImageForPost] db write failed", err);
    return { ok: false, error: "db_failed" };
  }

  return { ok: true, imageUrl: postBlobUrl };
}

/**
 * Replace the post's image with one the user has already saved to the
 * library. References the library blob URL directly — no copy, no
 * second blob upload. The library's cleanup logic protects in-use rows
 * via `lastUsedAt`, which this function bumps.
 *
 * Mirrors `uploadImageForPost`'s retain-then-swap order so the prior
 * post image (AI, uploaded, or library) lands back in the library
 * before being replaced.
 */
export async function pickFromLibraryForPost(
  sessionUserId: string,
  postId: string,
  libraryImageId: string,
): Promise<PickFromLibraryResult> {
  // 1. Ownership + batch lookup for the post.
  const [postRow] = await db
    .select({
      userId: posts.userId,
      batchId: posts.batchId,
      batchDeletedAt: weeklyBatches.deletedAt,
    })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!postRow || postRow.batchDeletedAt !== null) {
    return { ok: false, error: "not_found" };
  }
  if (postRow.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }

  // 2. Library image ownership lookup.
  const [libRow] = await db
    .select({
      userId: libraryImages.userId,
      imageUrl: libraryImages.imageUrl,
      imagePrompt: libraryImages.imagePrompt,
    })
    .from(libraryImages)
    .where(eq(libraryImages.id, libraryImageId))
    .limit(1);

  if (!libRow) {
    return { ok: false, error: "library_image_not_found" };
  }
  if (libRow.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }

  // 3. Source-aware cleanup of the prior image — same rules as
  //    uploadImageForPost (AI → delete blob, uploaded → retain to
  //    library, library → leave the blob alone).
  const cleanup = await cleanupPriorPostImage(sessionUserId, postId);
  if (!cleanup.ok) {
    console.error(
      "[imageService.pickFromLibraryForPost] prior-image cleanup failed",
      cleanup,
    );
    return { ok: false, error: "db_failed" };
  }

  // 4. Swap the post_images row + bump lastUsedAt in one transaction.
  try {
    await db.transaction(async (tx) => {
      await tx.delete(postImages).where(eq(postImages.postId, postId));
      await tx.insert(postImages).values({
        postId,
        userId: sessionUserId,
        imageUrl: libRow.imageUrl,
        imagePrompt: libRow.imagePrompt,
        source: "library",
        status: "success",
        attempt: 1,
      });
      await tx
        .update(libraryImages)
        .set({ lastUsedAt: new Date() })
        .where(eq(libraryImages.id, libraryImageId));
    });
  } catch (err) {
    console.error(
      "[imageService.pickFromLibraryForPost] db write failed",
      err,
    );
    return { ok: false, error: "db_failed" };
  }

  return { ok: true, imageUrl: libRow.imageUrl };
}
