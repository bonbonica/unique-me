import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as postGenerator from "@/lib/ai/post-generator";
import { db } from "@/lib/db";
import {
  type NewPostVariation,
  type Post,
  type PostVariation,
  type SelectionPlatform,
  type WeeklyBatch,
  postSelections,
  postVariations,
  posts,
  weeklyBatches,
} from "@/lib/schema";
import * as profileService from "./profile-service";
import * as subscriptionService from "./subscription-service";

/**
 * Phase 2 postService. Owns the full weekly-batch lifecycle from generation
 * through review through commit/cancel:
 *
 *  - {@link generateWeekly} — one Anthropic call → 7 canonical Facebook posts
 *    + IG/LinkedIn variations, all persisted in a single transaction.
 *  - {@link update}, {@link regenerate} — per-post edits during review.
 *    Regenerate enforces the universal 1× cap (D11) before touching the
 *    LLM, so we never pay for a call that can't be persisted.
 *  - {@link selectForNetwork}, {@link deselectForNetwork} — toggle a post's
 *    publish-to-network opt-in (D14). Row presence = selected; absence =
 *    not selected.
 *  - {@link scheduleMyPick} — single commit method that locks the batch
 *    into `"scheduling"` so Phase 4's calendar can take over.
 *  - {@link stopBatch} — cancel a locked batch ({@link stopBatch} only
 *    transitions `"scheduling"` → `"cancelled"`).
 *  - {@link getBatchForReview}, {@link getCurrentBatch}, {@link hasAnyBatch}
 *    — read helpers used by `/posts` and `/create`.
 *
 * Ownership rule: every mutation method takes `sessionUserId` and verifies
 * the target row's `userId` matches before touching the DB. Reads either
 * filter on `userId` in the WHERE clause or return null on ownership mismatch.
 */

// =============================================================================
// Public result types — discriminated unions, never throws
// =============================================================================

export type GenerateWeeklyResult =
  | {
      ok: true;
      batchId: string;
      postsCreated: number;
      variationsCreated: number;
    }
  | {
      ok: false;
      error: "no_profile" | "trial_batch_exists" | "ai_failed" | "db_failed";
      details?: string;
    };

export type UpdateResult =
  | { ok: true; post: Post }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "batch_locked" | "db_failed";
    };

export type RegenerateResult =
  | { ok: true; post: Post; variationsReplaced: number }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_owned"
        | "regeneration_limit_reached"
        | "batch_locked"
        | "ai_failed"
        | "db_failed";
    };

export type SelectionResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "batch_locked" | "db_failed";
    };

export type ScheduleResult =
  | { ok: true; batchId: string; committedSelections: number }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_owned"
        | "batch_already_locked"
        | "no_selections"
        | "db_failed";
    };

export type StopResult =
  | { ok: true; batchId: string }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "not_scheduling" | "db_failed";
    };

export type BatchForReview = {
  batch: WeeklyBatch;
  platforms: SelectionPlatform[];
  posts: Array<
    Post & {
      variations: { instagram?: PostVariation; linkedin?: PostVariation };
      selections: SelectionPlatform[];
    }
  >;
};

// =============================================================================
// Existence + simple reads
// =============================================================================

/**
 * Cheap existence check used by:
 *  - {@link subscriptionService.canGenerate} for the trial-1-batch cap (D20).
 *  - The `/create` page gate when deciding whether to show the form or the
 *    upgrade screen.
 *
 * Selects only the id column so it's safe on every authenticated page load.
 */
export async function hasAnyBatch(userId: string): Promise<boolean> {
  const row = await db.query.weeklyBatches.findFirst({
    where: eq(weeklyBatches.userId, userId),
    columns: { id: true },
  });
  return Boolean(row);
}

/**
 * Returns the most recent batch in `reviewing` or `scheduling` status, used
 * by `/posts` when no `?batchId=` query param is provided (the common case
 * right after Generate redirects). `cancelled` / `scheduled` / `completed`
 * batches don't surface — those are accessed via explicit `?batchId=...`.
 */
export async function getCurrentBatch(
  userId: string
): Promise<WeeklyBatch | null> {
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        inArray(weeklyBatches.status, ["reviewing", "scheduling"])
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return batch ?? null;
}

/**
 * Most-recent batch in ANY status (including `cancelled`, `scheduled`,
 * `completed`). Used by `/create` to find a trial user's only-ever batch
 * so the gated screen can deep-link back to it. `getCurrentBatch` only
 * surfaces `reviewing` / `scheduling`, which wasn't enough once cancelled
 * became a recoverable state.
 */
export async function getMostRecentBatch(
  userId: string
): Promise<WeeklyBatch | null> {
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(eq(weeklyBatches.userId, userId))
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return batch ?? null;
}

/**
 * Hydrate everything `/posts` needs in one bundle: the batch row, the user's
 * platform selection from onboarding (drives wizard step count), and the 7
 * posts each enriched with their variations + selection rows.
 *
 * Returns `null` when:
 *  - The batch doesn't exist.
 *  - The batch isn't owned by `sessionUserId`.
 *  - The user has no profile (defensive — the (onboarded) layout shouldn't
 *    let this happen).
 *
 * Cost: 4 DB roundtrips (batch, posts, variations, selections) + 1 profile
 * fetch inside profileService. Variations and selections are bulk-queried
 * with `inArray` and bucketed in JS to avoid N+1.
 */
export async function getBatchForReview(
  batchId: string,
  sessionUserId: string
): Promise<BatchForReview | null> {
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch || batch.userId !== sessionUserId) return null;

  const profile = await profileService.getProfile(sessionUserId);
  if (!profile) return null;

  // Cast: profile.platforms is `string[]` per Drizzle's inferred type because
  // the column is text[]. The onboarding form's Zod schema constrains the
  // values to the SelectionPlatform union, so the cast is safe under normal
  // operation.
  const platforms = profile.platforms as SelectionPlatform[];

  const postRows = await db
    .select()
    .from(posts)
    .where(eq(posts.batchId, batchId))
    .orderBy(asc(posts.postOrder));

  // Empty-batch defensive guard — drizzle's inArray() with an empty array
  // can behave inconsistently across versions, and skipping the join saves a
  // round-trip in the (unreachable) zero-post case.
  const postIds = postRows.map((p) => p.id);
  const variationRows =
    postIds.length > 0
      ? await db
          .select()
          .from(postVariations)
          .where(inArray(postVariations.postId, postIds))
      : [];
  const selectionRows =
    postIds.length > 0
      ? await db
          .select()
          .from(postSelections)
          .where(inArray(postSelections.postId, postIds))
      : [];

  const variationsByPostId = new Map<
    string,
    { instagram?: PostVariation; linkedin?: PostVariation }
  >();
  for (const v of variationRows) {
    const slot = variationsByPostId.get(v.postId) ?? {};
    if (v.platform === "instagram") slot.instagram = v;
    else if (v.platform === "linkedin") slot.linkedin = v;
    variationsByPostId.set(v.postId, slot);
  }

  const selectionsByPostId = new Map<string, SelectionPlatform[]>();
  for (const s of selectionRows) {
    const slot = selectionsByPostId.get(s.postId) ?? [];
    slot.push(s.platform as SelectionPlatform);
    selectionsByPostId.set(s.postId, slot);
  }

  return {
    batch,
    platforms,
    posts: postRows.map((p) => ({
      ...p,
      variations: variationsByPostId.get(p.id) ?? {},
      selections: selectionsByPostId.get(p.id) ?? [],
    })),
  };
}

// =============================================================================
// generateWeekly — the entry point that produces a batch
// =============================================================================

/**
 * Produce the weekly batch end-to-end:
 *   1. Profile check — onboarding must be complete.
 *   2. Gate check — `subscriptionService.canGenerate` is the permanent home
 *      for plan/credit gates. Phase 2 only implements the trial-1-batch cap
 *      (D20); Phase 3 will expand it.
 *   3. AI call via {@link postGenerator.generate} — never throws, may return
 *      null which we map to `ai_failed`.
 *   4. Single DB transaction:
 *      - 1 row in `weekly_batches` (status `"reviewing"`).
 *      - 7 rows in `posts` (status `"draft"`).
 *      - 0–14 rows in `post_variations` (0 or 2 per post, per Pro / Starter).
 *
 * Either the whole transaction commits or the whole thing rolls back — we
 * never persist a partial batch.
 */
export async function generateWeekly(
  userId: string,
  input: { theme: string; importantThing: string }
): Promise<GenerateWeeklyResult> {
  const profile = await profileService.getProfile(userId);
  if (!profile) return { ok: false, error: "no_profile" };

  const gate = await subscriptionService.canGenerate(userId);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason };
  }

  // TODO(phase-3-gating): credit gate for non-trial users will live behind
  // subscriptionService.canGenerate. Trial users are already gated by D20.

  const generated = await postGenerator.generate({
    profile,
    theme: input.theme,
    importantThing: input.importantThing,
  });
  if (!generated) return { ok: false, error: "ai_failed" };

  try {
    const result = await db.transaction(async (tx) => {
      const batchId = crypto.randomUUID();
      await tx.insert(weeklyBatches).values({
        id: batchId,
        userId,
        theme: input.theme,
        importantThing: input.importantThing,
        totalPosts: 7,
        acceptedPosts: 0,
        skippedPosts: 0,
        status: "reviewing",
      });

      const postRows = generated.posts.map((p) => ({
        id: crypto.randomUUID(),
        batchId,
        userId,
        postText: p.postText,
        hashtags: p.hashtags,
        postOrder: p.postOrder,
        status: "draft" as const,
        regenerationCount: 0,
      }));
      await tx.insert(posts).values(postRows);

      // TODO(phase-3-gating): skip the variation insert when the user is on
      // the Starter plan. Phase 2 treats every user as Pro for development;
      // variation rows are unconditionally inserted when the AI returns them.
      const variationRows: NewPostVariation[] = [];
      for (let i = 0; i < generated.posts.length; i++) {
        const aiPost = generated.posts[i]!;
        const dbPostId = postRows[i]!.id;
        if (aiPost.variations.instagram) {
          variationRows.push({
            id: crypto.randomUUID(),
            postId: dbPostId,
            userId,
            platform: "instagram",
            postText: aiPost.variations.instagram.postText,
            hashtags: aiPost.variations.instagram.hashtags,
          });
        }
        if (aiPost.variations.linkedin) {
          variationRows.push({
            id: crypto.randomUUID(),
            postId: dbPostId,
            userId,
            platform: "linkedin",
            postText: aiPost.variations.linkedin.postText,
            hashtags: aiPost.variations.linkedin.hashtags,
          });
        }
      }
      if (variationRows.length > 0) {
        await tx.insert(postVariations).values(variationRows);
      }

      return { batchId, variationsCreated: variationRows.length };
    });

    return {
      ok: true,
      batchId: result.batchId,
      postsCreated: 7,
      variationsCreated: result.variationsCreated,
    };
  } catch (err) {
    console.error("[postService.generateWeekly] db error", err);
    return { ok: false, error: "db_failed", details: String(err) };
  }
}

// =============================================================================
// Per-post mutations: update, regenerate
// =============================================================================

/**
 * Edit a post's canonical text + hashtags. No AI call; no `regenerationCount`
 * change. Variations stay stale — the Wizard's R12 inline note surfaces this
 * to the user.
 */
export async function update(
  postId: string,
  sessionUserId: string,
  updates: { postText?: string; hashtags?: string[] }
): Promise<UpdateResult> {
  const [row] = await db
    .select({
      post: posts,
      batchStatus: weeklyBatches.status,
    })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!row) return { ok: false, error: "not_found" };
  if (row.post.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  // Allowed in `"reviewing"` AND `"cancelled"` — the cancelled-recoverable
  // flow lets trial users keep editing within their 7-day window. Any
  // other status (scheduling, scheduled, completed) is hard-locked.
  if (
    row.batchStatus !== "reviewing" &&
    row.batchStatus !== "cancelled"
  ) {
    return { ok: false, error: "batch_locked" };
  }

  try {
    const result = await db
      .update(posts)
      .set({
        ...(updates.postText !== undefined
          ? { postText: updates.postText }
          : {}),
        ...(updates.hashtags !== undefined
          ? { hashtags: updates.hashtags }
          : {}),
        status: "edited",
      })
      .where(eq(posts.id, postId))
      .returning();

    if (result.length === 0) {
      // Should be unreachable — the select above proved the row exists, and
      // no other path deletes posts during a batch lifecycle. Defensive.
      return { ok: false, error: "not_found" };
    }
    return { ok: true, post: result[0]! };
  } catch (err) {
    console.error("[postService.update]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Rewrite a single post given user feedback. Enforces the universal 1×
 * regeneration cap (D11) *before* the AI call — we don't want to pay for an
 * Anthropic call that can't be persisted.
 *
 * Order of checks:
 *   1. existence  → not_found
 *   2. ownership  → not_owned
 *   3. batch lock → batch_locked
 *   4. cap        → regeneration_limit_reached
 *   5. AI call    → ai_failed on null
 *   6. transaction (delete old variations, insert new, update post)
 */
export async function regenerate(
  postId: string,
  sessionUserId: string,
  feedback: string
): Promise<RegenerateResult> {
  const [row] = await db
    .select({
      post: posts,
      batchStatus: weeklyBatches.status,
      batchTheme: weeklyBatches.theme,
      batchImportant: weeklyBatches.importantThing,
    })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!row) return { ok: false, error: "not_found" };
  if (row.post.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  if (row.batchStatus !== "reviewing") {
    return { ok: false, error: "batch_locked" };
  }
  if (row.post.regenerationCount >= 1) {
    return { ok: false, error: "regeneration_limit_reached" };
  }

  const profile = await profileService.getProfile(sessionUserId);
  if (!profile) {
    // Onboarding gate would normally prevent this — defensive only.
    return { ok: false, error: "not_owned" };
  }

  const result = await postGenerator.regenerateOne({
    profile,
    theme: row.batchTheme,
    importantThing: row.batchImportant,
    currentPostText: row.post.postText,
    currentHashtags: row.post.hashtags,
    feedback,
    postOrder: row.post.postOrder,
  });
  if (!result) return { ok: false, error: "ai_failed" };

  try {
    const updated = await db.transaction(async (tx) => {
      // Replace the post's variations atomically with the new ones.
      await tx
        .delete(postVariations)
        .where(eq(postVariations.postId, postId));

      const variationRows: NewPostVariation[] = [];
      // TODO(phase-3-gating): skip these inserts when the user is on Starter.
      if (result.variations.instagram) {
        variationRows.push({
          id: crypto.randomUUID(),
          postId,
          userId: sessionUserId,
          platform: "instagram",
          postText: result.variations.instagram.postText,
          hashtags: result.variations.instagram.hashtags,
        });
      }
      if (result.variations.linkedin) {
        variationRows.push({
          id: crypto.randomUUID(),
          postId,
          userId: sessionUserId,
          platform: "linkedin",
          postText: result.variations.linkedin.postText,
          hashtags: result.variations.linkedin.hashtags,
        });
      }
      if (variationRows.length > 0) {
        await tx.insert(postVariations).values(variationRows);
      }

      const updateResult = await tx
        .update(posts)
        .set({
          postText: result.postText,
          hashtags: result.hashtags,
          feedback,
          regenerationCount: row.post.regenerationCount + 1,
          status: "edited",
        })
        .where(eq(posts.id, postId))
        .returning();

      if (updateResult.length === 0) {
        throw new Error("post update returned no rows");
      }

      return {
        post: updateResult[0]!,
        variationsReplaced: variationRows.length,
      };
    });

    return {
      ok: true,
      post: updated.post,
      variationsReplaced: updated.variationsReplaced,
    };
  } catch (err) {
    console.error("[postService.regenerate]", err);
    return { ok: false, error: "db_failed" };
  }
}

// =============================================================================
// Selection toggle (per-post-per-network opt-in)
// =============================================================================

/**
 * Shared post + batch ownership/lock check used by both selection methods.
 * Returns the validated row info or an error variant ready to short-circuit
 * the caller.
 */
async function loadPostForSelectionMutation(
  postId: string,
  sessionUserId: string
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "batch_locked" }
> {
  const [row] = await db
    .select({ userId: posts.userId, batchStatus: weeklyBatches.status })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!row) return { ok: false, error: "not_found" };
  if (row.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  // Selection toggles allowed in both `"reviewing"` and `"cancelled"` so
  // the cancelled-recoverable flow lets users re-pick what to re-schedule.
  if (
    row.batchStatus !== "reviewing" &&
    row.batchStatus !== "cancelled"
  ) {
    return { ok: false, error: "batch_locked" };
  }
  return { ok: true };
}

export async function selectForNetwork(
  postId: string,
  sessionUserId: string,
  platform: SelectionPlatform
): Promise<SelectionResult> {
  const guard = await loadPostForSelectionMutation(postId, sessionUserId);
  if (!guard.ok) return guard;

  try {
    await db
      .insert(postSelections)
      .values({
        id: crypto.randomUUID(),
        postId,
        userId: sessionUserId,
        platform,
      })
      .onConflictDoNothing({
        target: [postSelections.postId, postSelections.platform],
      });
    return { ok: true };
  } catch (err) {
    console.error("[postService.selectForNetwork]", err);
    return { ok: false, error: "db_failed" };
  }
}

export async function deselectForNetwork(
  postId: string,
  sessionUserId: string,
  platform: SelectionPlatform
): Promise<SelectionResult> {
  const guard = await loadPostForSelectionMutation(postId, sessionUserId);
  if (!guard.ok) return guard;

  try {
    await db
      .delete(postSelections)
      .where(
        and(
          eq(postSelections.postId, postId),
          eq(postSelections.platform, platform)
        )
      );
    return { ok: true };
  } catch (err) {
    console.error("[postService.deselectForNetwork]", err);
    return { ok: false, error: "db_failed" };
  }
}

// =============================================================================
// Batch lifecycle: scheduleMyPick, reschedule, stopBatch
// =============================================================================

/**
 * The single commit method. Reads current selections, refuses to lock an
 * empty batch, then race-safely transitions `weekly_batches.status` from
 * `"reviewing"` to `"scheduling"`. Phase 4 picks up from there.
 *
 * Race safety: the UPDATE statement guards on `status = "reviewing"` so two
 * concurrent calls produce a single winner; the loser sees zero rows
 * affected and returns `batch_already_locked`.
 */
export async function scheduleMyPick(
  batchId: string,
  sessionUserId: string
): Promise<ScheduleResult> {
  const [batch] = await db
    .select({
      userId: weeklyBatches.userId,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  if (batch.status !== "reviewing") {
    return { ok: false, error: "batch_already_locked" };
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postSelections)
    .innerJoin(posts, eq(posts.id, postSelections.postId))
    .where(eq(posts.batchId, batchId));

  const selectionCount = countRow?.count ?? 0;
  if (selectionCount === 0) {
    return { ok: false, error: "no_selections" };
  }

  try {
    const updateResult = await db
      .update(weeklyBatches)
      .set({ status: "scheduling" })
      .where(
        and(
          eq(weeklyBatches.id, batchId),
          eq(weeklyBatches.status, "reviewing")
        )
      )
      .returning({ id: weeklyBatches.id });

    if (updateResult.length === 0) {
      // Another tab / request transitioned the batch between the check above
      // and the update. Surface as the standard locked error.
      return { ok: false, error: "batch_already_locked" };
    }

    return {
      ok: true,
      batchId,
      committedSelections: selectionCount,
    };
  } catch (err) {
    console.error("[postService.scheduleMyPick]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Move a cancelled batch back to `"scheduling"` (cancelled-recoverable
 * flow). Mirror of {@link scheduleMyPick} but operates on a batch that
 * was previously stopped — same selection-count check, same race-safe
 * UPDATE pattern. Trial users can use this to recover their one batch
 * within the 7-day window without burning the trial-cap (the cap is
 * keyed on whether a batch EXISTS, not on its status).
 *
 * Phase 4's calendar will eventually close the recoverable window
 * (cancelled batches past Day 7 stop accepting `reschedule`). Until
 * Phase 4 lands, the loop reviewing → scheduling → cancelled →
 * scheduling → cancelled stays open.
 */
export async function reschedule(
  batchId: string,
  sessionUserId: string
): Promise<ScheduleResult> {
  const [batch] = await db
    .select({
      userId: weeklyBatches.userId,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  if (batch.status !== "cancelled") {
    return { ok: false, error: "batch_already_locked" };
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postSelections)
    .innerJoin(posts, eq(posts.id, postSelections.postId))
    .where(eq(posts.batchId, batchId));

  const selectionCount = countRow?.count ?? 0;
  if (selectionCount === 0) {
    return { ok: false, error: "no_selections" };
  }

  try {
    const updateResult = await db
      .update(weeklyBatches)
      .set({ status: "scheduling" })
      .where(
        and(
          eq(weeklyBatches.id, batchId),
          eq(weeklyBatches.status, "cancelled")
        )
      )
      .returning({ id: weeklyBatches.id });

    if (updateResult.length === 0) {
      return { ok: false, error: "batch_already_locked" };
    }

    return {
      ok: true,
      batchId,
      committedSelections: selectionCount,
    };
  } catch (err) {
    console.error("[postService.reschedule]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Cancel a committed batch. Only valid when the batch is in `"scheduling"`
 * status — Phase 2 doesn't support pre-schedule abandonment as a distinct
 * action (the "Stop entire batch" button only renders after Schedule per
 * the spec § 8.2.B).
 *
 * Status-guarded UPDATE is race-safe in the same way as `scheduleMyPick`.
 */
export async function stopBatch(
  batchId: string,
  sessionUserId: string
): Promise<StopResult> {
  const [batch] = await db
    .select({
      userId: weeklyBatches.userId,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  if (batch.status !== "scheduling") {
    return { ok: false, error: "not_scheduling" };
  }

  try {
    const updateResult = await db
      .update(weeklyBatches)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(weeklyBatches.id, batchId),
          eq(weeklyBatches.status, "scheduling")
        )
      )
      .returning({ id: weeklyBatches.id });

    if (updateResult.length === 0) {
      return { ok: false, error: "not_scheduling" };
    }
    return { ok: true, batchId };
  } catch (err) {
    console.error("[postService.stopBatch]", err);
    return { ok: false, error: "db_failed" };
  }
}
