import "server-only";

import { after } from "next/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as postGenerator from "@/lib/ai/post-generator";
import { spellCheckBatchInputs } from "@/lib/ai/spell-check";
import { db } from "@/lib/db";
import {
  resolveBatchPlan,
  resolveLengthsForBatch,
} from "@/lib/scheduling/batch-calendar";
import {
  type NewPostVariation,
  type Post,
  type PostLength,
  type PostingDays,
  type PostVariation,
  type SelectionPlatform,
  type WeeklyBatch,
  connectedAccounts,
  postImages,
  postSelections,
  postVariations,
  posts,
  scheduledPosts,
  weeklyBatches,
} from "@/lib/schema";
import * as imageService from "./image-service";
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
      // Phase 3 spec § 7.2: the `canGenerate` reasons are forwarded verbatim
      // into this error union rather than being mapped to a new variant. When
      // `canGenerate` adds a reason, this union adds the same string.
      error:
        | "no_profile"
        | "trial_batch_exists"
        | "weekly_cap_active"
        | "monthly_cap_active"
        | "starter_platforms_overage"
        | "plan_inactive"
        | "ai_failed"
        | "db_failed";
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

export type CancelPostResult =
  | { ok: true; batchId: string; cancelledCount: number }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "already_posted" | "db_failed";
    };

export type RestorePostResult =
  | { ok: true; batchId: string; restoredCount: number }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "not_restorable" | "db_failed";
    };

/**
 * Image-generation Wave 1 status snapshot for one post. Returned as part of
 * {@link BatchForReview} for SSR, and from {@link getBatchImageStatuses}
 * for client polling. `imageUrl` is null for any state other than
 * `"success"` (invariant enforced by the column nullability + the
 * runImageGenerationForBatch flow).
 */
export type PostImageStatus = {
  status: "pending" | "generating" | "success" | "failed" | "regenerating";
  imageUrl: string | null;
  // Wave 2: 1 = original generation, 2 = used the retry/regenerate. The UI
  // reads this to decide whether to render the retry/regenerate control
  // (attempt < 2) or the exhausted-state message (attempt >= 2).
  attempt: number;
  // Wave 2: the `post_images` row id. Surfaced so tiles can hand it back
  // to retryImageAction / regenerateImageAction without a second lookup.
  // The outer Record is keyed by `postId` (NOT this id) so the UI can
  // render one tile per post.
  id: string;
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
  /**
   * Image-generation Wave 1: per-post image status, keyed by `post.id`. A
   * post with no `post_images` row (pre-Wave-1 legacy batches) is simply
   * absent from this record — UI components treat `undefined` as
   * "no image to show" without distinguishing it from `failed`.
   */
  images: Record<string, PostImageStatus>;
};

/**
 * Card shape for the Create Posts hub's unscheduled-batches list. Returned
 * by {@link getUnscheduledBatchesForUser}; consumed by `<UnscheduledBatchList />`
 * and `<UnscheduledBatchCard />`. `status` is narrowed to the subset of
 * `weeklyBatches.status` values that surface on the hub.
 */
export type UnscheduledBatchCard = {
  id: string;
  theme: string;
  importantThing: string;
  totalPosts: number;
  /**
   * `weeklyBatches.batchOrdinalInPeriod`. Pro: 1–4, assigned at generation
   * time from `proQuota.used + 1` and frozen for the life of the row — so a
   * cancelled batch keeps the slot number it was created at. Trial / Starter:
   * `null` (those plans have different cap mechanisms — Trial=1 lifetime,
   * Starter=1 per rolling 7d — and don't need a /4 ordinal).
   */
  ordinal: number | null;
  status: "reviewing" | "cancelled";
  counts: { facebook: number; instagram: number; linkedin: number };
};

/**
 * Box-shaped data for a single "current period" batch on the Posting Soon
 * page. Returned inside {@link ScheduledView.current} by
 * {@link getScheduledViewForUser}; consumed by `<ScheduledBatchBox />`.
 *
 * Stage-1 dormant contract — two fields ride along today as safe defaults
 * but will activate when Phase 7 (`postingService`) ships without any
 * component changes:
 *  - `alreadyPostedCount`: always `0` in Stage-1. Phase 7 populates with
 *    `COUNT(scheduled_posts.status='posted')` per batch.
 *  - `queuedCount`: always equal to `totalPosts` in Stage-1. Phase 7 sets it
 *    to `totalPosts - alreadyPostedCount`.
 *
 * The previous `derivedState` field (with a dormant `"currently_posting"`
 * member) was removed by the navigation redesign — the "Currently Posting"
 * concept is gone from the IA.
 */
export type BatchBoxData = {
  id: string;
  /**
   * `weeklyBatches.batchOrdinalInPeriod`. Pro: 1–4. Trial / Starter: `null`
   * (those plans never need disambiguating between concurrent batches).
   */
  ordinal: number | null;
  theme: string;
  importantThing: string;
  /**
   * Nominal post count from `weeklyBatches.totalPosts` (7 for Trial / Starter,
   * 7 or 9 for Pro depending on the batch). Same source `/create`'s
   * {@link UnscheduledBatchCard.totalPosts} reads from — keeps the two pages
   * in agreement.
   *
   * NOT a live "what will actually publish" count today. A future spec wave
   * that pairs (a) a `scheduled_posts` writer (Phase-4 cron) with (b) the
   * cancel UI will swap this to a `scheduled_posts`-backed live count — see
   * {@link getScheduledViewForUser}'s docblock for the switchover criteria.
   */
  totalPosts: number;
  counts: { facebook: number; instagram: number; linkedin: number };
  // Stage-1 dormant: see type-level docblock above.
  alreadyPostedCount: number;
  // Stage-1 dormant: see type-level docblock above.
  queuedCount: number;
};

/**
 * Bundle returned by {@link getScheduledViewForUser}. Stage-2 collapses to a
 * single rolling-4 list — there is no separate "past batches" surface and no
 * 30-day period window (the spec replaced the period anchor with the
 * scheduling-service's rolling-4 eviction; D-S2-11).
 *
 * `scheduledBatchCount` mirrors `current.length` in Stage-2 (because the
 * schedule-service caps the count at 4 upstream) but is exposed as its own
 * field so callers — notably `<QuotaCountdownPill />` (D-S2-10) — can keep
 * reading a stable number even if a future spec relaxes the cap or caps
 * `current` differently.
 */
export type ScheduledView = {
  current: BatchBoxData[];
  scheduledBatchCount: number;
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
 * Total number of user-facing posts the user has ever generated, summed
 * across every live batch they own. "User-facing" = the `weeklyBatches.totalPosts`
 * count (7 or 9 per batch, already filtered by `postingDays` at creation
 * time) — NOT the per-network FB/IG/LI variations, which would 3× the count.
 *
 * Soft-deleted batches are excluded (`deletedAt IS NULL`) so the number stays
 * consistent with every other user-facing read in this service and with the
 * quota-soft-delete contract (tombstones never reappear in the UI).
 *
 * All non-terminal statuses count, including `cancelled` — those posts were
 * still created by the user, even if their schedule was later stopped.
 * Returns 0 for a user with no batches.
 */
export async function countTotalPostsCreated(userId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${weeklyBatches.totalPosts}), 0)::int`,
    })
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        isNull(weeklyBatches.deletedAt)
      )
    );
  return row?.total ?? 0;
}

/**
 * Navigation-redesign Wave 3 (task-09 → moved to Settings): count every
 * scheduled_posts row for the user that is still `'pending'` — i.e. waiting
 * to publish. Feeds the "Posts Scheduled" stat box on `/settings`. Joins
 * through posts → weekly_batches so we only count rows for batches the user
 * still owns and that aren't tombstoned.
 */
export async function countScheduledPendingForUser(
  userId: string
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(count(*), 0)::int`,
    })
    .from(scheduledPosts)
    .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        eq(scheduledPosts.status, "pending"),
        isNull(weeklyBatches.deletedAt)
      )
    );
  return row?.total ?? 0;
}

/**
 * Navigation-redesign Wave 3 (task-09 → moved to Settings): count distinct
 * platforms (0–3, from FB / IG / LI) the user has connected. Feeds the
 * "Connected Accounts" stat box on `/settings`. Phase 5+ will own the OAuth
 * flow that writes to `connected_accounts`; today the row count is whatever
 * is currently seeded.
 */
export async function countConnectedPlatformsForUser(
  userId: string
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(count(distinct ${connectedAccounts.platform}), 0)::int`,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId));
  return row?.total ?? 0;
}

/**
 * Most recent batch in `reviewing` or `scheduling` status. Narrow contract
 * preserved for callers that explicitly want the "still being generated /
 * reviewed / locked-but-not-yet-scheduled" window — i.e. the in-flight
 * states immediately around generation. The bare-`/posts` fallback used to
 * call this; it now calls {@link getResumableBatch} so a user with only a
 * `scheduled` or `cancelled` batch can still navigate back to it.
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
        inArray(weeklyBatches.status, ["reviewing", "scheduling"]),
        // Soft-delete tombstones must not appear in any user-facing batch
        // read (quota-soft-delete spec §4).
        isNull(weeklyBatches.deletedAt)
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return batch ?? null;
}

/**
 * Most recent batch in any *resumable* status — `reviewing`, `scheduling`,
 * `scheduled`, or `cancelled`. Used by `/posts` when no `?batchId=` query
 * param is supplied (sidebar "My Posts" link — "resume what you were last
 * working on" semantics).
 *
 * Resolves regardless of subscription plan — viewing or managing an
 * existing batch is never gated. Only generating a *new* batch goes through
 * `subscriptionService.canGenerate`.
 *
 * `completed` is excluded (Phase 4 owns that surface) and `in_progress` is
 * excluded (stale/unreachable status; defensive).
 */
export async function getResumableBatch(
  userId: string
): Promise<WeeklyBatch | null> {
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        inArray(weeklyBatches.status, [
          "reviewing",
          "scheduling",
          "scheduled",
          "cancelled",
        ]),
        // Quota-soft-delete §4: tombstones never resume.
        isNull(weeklyBatches.deletedAt)
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
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        // Quota-soft-delete §4: tombstones excluded from the deep-link target.
        isNull(weeklyBatches.deletedAt)
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return batch ?? null;
}

/**
 * Bulk-load per-network selection counts for a set of batches. One query for
 * all batches; rows are aggregated in the DB via GROUP BY so we never pull
 * raw selection rows into JS just to count them.
 *
 * The returned map is keyed by `batchId` and every requested id is pre-seeded
 * with `{ facebook: 0, instagram: 0, linkedin: 0 }`, so callers can do
 * `map.get(id)` without a nullish-coalesce fallback. The empty-input case
 * returns an empty Map without issuing a query — `inArray(..., [])` produces
 * a `WHERE col IN ()` clause that Postgres rejects.
 *
 * Module-private on purpose: it's the same shape both the Create Posts hub
 * cards (`getUnscheduledBatchesForUser`) and the Scheduled view boxes
 * (`getScheduledViewForUser`) need; duplicating the query in two readers
 * would let them drift out of sync with what `<NetworkWizard />` shows.
 */
async function loadSelectionCounts(
  batchIds: string[]
): Promise<Map<string, { facebook: number; instagram: number; linkedin: number }>> {
  const countsByBatch = new Map<
    string,
    { facebook: number; instagram: number; linkedin: number }
  >();
  for (const id of batchIds) {
    countsByBatch.set(id, { facebook: 0, instagram: 0, linkedin: 0 });
  }

  if (batchIds.length === 0) return countsByBatch;

  // Join path: post_selections.postId → posts.id → posts.batchId. There is no
  // direct post_selections.batchId column. Aggregating in SQL keeps memory
  // bounded regardless of how many selection rows exist per batch.
  const selectionRows = await db
    .select({
      batchId: posts.batchId,
      platform: postSelections.platform,
      count: sql<number>`count(*)::int`,
    })
    .from(postSelections)
    .innerJoin(posts, eq(postSelections.postId, posts.id))
    .where(inArray(posts.batchId, batchIds))
    .groupBy(posts.batchId, postSelections.platform);

  for (const row of selectionRows) {
    // Defensive: posts.batchId is non-null at the schema level, but the join
    // projection types it as nullable. Skip the (impossible) null case rather
    // than assert with `!` so a future schema change can't introduce a silent
    // miscount.
    if (!row.batchId) continue;
    const bucket = countsByBatch.get(row.batchId);
    if (!bucket) continue;
    if (row.platform === "facebook") bucket.facebook = row.count;
    else if (row.platform === "instagram") bucket.instagram = row.count;
    else if (row.platform === "linkedin") bucket.linkedin = row.count;
  }

  return countsByBatch;
}

/**
 * Every batch the user owns that is currently sitting on the Create Posts
 * hub — `status ∈ {reviewing, cancelled}`. Sorted newest-first so the most
 * recently touched batch is the top card. Per-network counts come from
 * `post_selections` (the same source `<NetworkWizard />` reads from) so the
 * card's `FB N · IG N · LI N` row stays consistent with what the user sees
 * when they click into the wizard.
 *
 * Pure read; no writes, no `canGenerate` interaction, no side effects.
 * Capped at four rows in practice (Pro's max unscheduled-batch count), so
 * no paging.
 */
export async function getUnscheduledBatchesForUser(
  userId: string
): Promise<UnscheduledBatchCard[]> {
  const rows = await db
    .select({
      id: weeklyBatches.id,
      theme: weeklyBatches.theme,
      importantThing: weeklyBatches.importantThing,
      totalPosts: weeklyBatches.totalPosts,
      ordinal: weeklyBatches.batchOrdinalInPeriod,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        inArray(weeklyBatches.status, ["reviewing", "cancelled"]),
        // Quota-soft-delete §4: tombstones never appear in the /create hub.
        isNull(weeklyBatches.deletedAt)
      )
    )
    .orderBy(desc(weeklyBatches.createdAt));

  if (rows.length === 0) return [];

  const countsByBatch = await loadSelectionCounts(rows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    theme: r.theme,
    importantThing: r.importantThing,
    totalPosts: r.totalPosts,
    // Frozen at generation time (see /create/actions.ts:78). Pro: 1–4; Trial /
    // Starter: null. A cancelled batch keeps the slot number it was created
    // at, so the user can see which slot was burned even after cancelling.
    ordinal: r.ordinal,
    // The DB column is the broader `weeklyBatchStatus` enum; the WHERE clause
    // above narrows the actual values to this literal pair, so the cast is
    // type-safe at runtime.
    status: r.status as "reviewing" | "cancelled",
    counts: countsByBatch.get(r.id) ?? {
      facebook: 0,
      instagram: 0,
      linkedin: 0,
    },
  }));
}

/**
 * Data bundle for the Scheduled page (Stage-2 rewrite — D-S2-11, D-S2-12,
 * plus the Cancel-vs-Delete contract at §0).
 *
 * Returns the user's rolling-4 batches: at most 4 rows in
 * `status IN ('scheduling', 'completed')`, sorted `createdAt DESC` so the
 * newest occupies the first 2x2 grid cell. The Stage-1 period window
 * (`periodStartDate` / `periodEndsAt`) is gone — the schedule-service's
 * rolling-4 eviction enforces the cap upstream, so this read just trusts
 * `LIMIT 4`.
 *
 * `BatchBoxData.totalPosts` reads `weeklyBatches.totalPosts` (the nominal
 * column) and `BatchBoxData.counts.*` reads `post_selections` via
 * {@link loadSelectionCounts} — the **same sources** `/create` cards use via
 * {@link getUnscheduledBatchesForUser}. Keeping both pages on identical
 * readers means the box on `/schedule` and the card on `/create` for the
 * same batch always show the same FB / IG / LI / `{N} posts` numbers.
 *
 * **Why not the `scheduled_posts`-backed reader the Cancel-vs-Delete spec
 * (§5.3, §6.7) describes?** That reader is the future state. Two
 * preconditions must BOTH be true before we can switch:
 *   1. A writer populates `scheduled_posts` rows when a batch transitions
 *      to `scheduling` (Phase-4 cron, or an explicit service in
 *      `scheduleBatch`). Until that exists, the table is empty and a
 *      `scheduled_posts`-backed reader returns 0 for every batch.
 *   2. The cancel UI (task-15) can flip rows to `status='cancelled'`. Until
 *      that ships, there is nothing for the reader to filter out — the
 *      "selections except cancelled" predicate collapses to "selections."
 * Until BOTH land, reading `post_selections` + nominal `totalPosts` is the
 * correct present-day truth (the wizard freezes selections when the batch
 * flips from `reviewing` to `scheduling`, so they don't drift). Switch the
 * reader in the wave that pairs (1) and (2). Spec §5.3 carries the same note.
 *
 * `BatchBoxData` does NOT carry a `days[]` field (Wave-4 corrections at §0,
 * D-S2-12). The per-day / per-network view lives on `/schedule/[batchId]`
 * as a network × day grid (D-S2-15), fed by an independent data path that is
 * not affected by this function.
 *
 * Stage-1 dormant fields (`alreadyPostedCount`, `queuedCount`) still default
 * to the safe values documented on {@link BatchBoxData} — Phase 7 will
 * compute real values without touching this function's signature.
 *
 * Query plan (2 queries when batches exist; 1 when not):
 *  1. Top-4 batches by `createdAt DESC` filtered to `status IN ('scheduling',
 *     'completed')` for `userId`.
 *  2. {@link loadSelectionCounts} — per-network selection counts for the same
 *     batch ids (shared with `getUnscheduledBatchesForUser`).
 *
 * `scheduledBatchCount` is set from `current.length` — see the `ScheduledView`
 * docblock for the rationale (rolling-4 invariant is enforced upstream).
 */
export async function getScheduledViewForUser(
  userId: string
): Promise<ScheduledView> {
  // D-S2-11: rolling-4 in `scheduling` or `completed`, newest first. No
  // period window — task-06's `scheduleService.scheduleBatch` is the place
  // that prevents a 5th row from existing.
  const rows = await db
    .select({
      id: weeklyBatches.id,
      theme: weeklyBatches.theme,
      importantThing: weeklyBatches.importantThing,
      totalPosts: weeklyBatches.totalPosts,
      status: weeklyBatches.status,
      ordinal: weeklyBatches.batchOrdinalInPeriod,
      createdAt: weeklyBatches.createdAt,
    })
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        // Cancelled, reviewing, in_progress all live elsewhere (cancelled +
        // reviewing on /create; in_progress is Phase-7 only).
        inArray(weeklyBatches.status, ["scheduling", "completed"]),
        // Quota-soft-delete §4: tombstones never appear on /schedule.
        isNull(weeklyBatches.deletedAt)
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(4);

  if (rows.length === 0) {
    return { current: [], scheduledBatchCount: 0 };
  }

  const batchIds = rows.map((r) => r.id);

  // Per-network selection counts — same helper `/create` uses, so the two
  // pages agree on FB/IG/LI counts for the same batch. Pre-seeds zeros for
  // every batch id so the lookup below never needs a nullish fallback.
  // See this function's docblock for why the spec's `scheduled_posts`-backed
  // reader is deferred until Phase-4 cron + cancel UI both ship.
  const countsByBatch = await loadSelectionCounts(batchIds);

  const current: BatchBoxData[] = rows.map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    theme: r.theme,
    importantThing: r.importantThing,
    // Nominal total from weeklyBatches.totalPosts — same source `/create`
    // uses via getUnscheduledBatchesForUser. See the field's docblock.
    totalPosts: r.totalPosts,
    counts: countsByBatch.get(r.id) ?? {
      facebook: 0,
      instagram: 0,
      linkedin: 0,
    },
    // Stage-1 dormant defaults unchanged — Phase 7 still owns the flip.
    alreadyPostedCount: 0,
    queuedCount: r.totalPosts,
  }));

  return {
    current,
    // Rolling-4 invariant is enforced upstream by `scheduleService.scheduleBatch`
    // (task-06), so `current.length` IS the true count in Stage-2 and we avoid
    // an extra `count(*)` round-trip. If a future spec relaxes the cap, swap
    // in a dedicated count query — the field shape doesn't change.
    scheduledBatchCount: current.length,
  };
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
    .where(
      and(
        eq(weeklyBatches.id, batchId),
        // Quota-soft-delete §4: a soft-deleted batch returns null here, the
        // same shape callers already handle as "not found".
        isNull(weeklyBatches.deletedAt)
      )
    )
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

  // Image-generation Wave 1: per-post image status. Loaded as part of the
  // initial SSR so the first paint shows the correct skeleton / image
  // state without flicker. Pre-Wave-1 batches have no rows here; the
  // resulting `images` record is empty and downstream components render
  // a no-image placeholder for posts missing from the map.
  const imageRows =
    postIds.length > 0
      ? await db
          .select({
            id: postImages.id,
            postId: postImages.postId,
            status: postImages.status,
            imageUrl: postImages.imageUrl,
            attempt: postImages.attempt,
          })
          .from(postImages)
          .where(inArray(postImages.postId, postIds))
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

  const images: Record<string, PostImageStatus> = {};
  for (const r of imageRows) {
    // Defensive cast: status is `text` in Drizzle; runtime values are
    // constrained by the service layer (runImageGenerationForBatch + the
    // pending-row pre-insert in generateWeekly).
    images[r.postId] = {
      id: r.id,
      status: r.status as PostImageStatus["status"],
      imageUrl: r.imageUrl,
      attempt: r.attempt,
    };
  }

  return {
    batch,
    platforms,
    posts: postRows.map((p) => ({
      ...p,
      variations: variationsByPostId.get(p.id) ?? {},
      selections: selectionsByPostId.get(p.id) ?? [],
    })),
    images,
  };
}

/**
 * Image-generation Wave 1 polling endpoint. Returns the per-post image-
 * status map for `batchId`, ownership-gated against `sessionUserId` via
 * the `posts.userId` join. Returns an empty record when:
 *   - The batch doesn't exist or isn't owned by the session user (no
 *     rows match the join's WHERE clause).
 *   - The batch is pre-Wave-1 (no `post_images` rows).
 *
 * Same return shape as {@link BatchForReview.images}, so the client can
 * merge polling results into its initial-SSR state with one
 * `Object.assign`. Single query — cheap to poll every ~2.5s while any
 * row is `"pending"` or `"generating"`.
 */
export async function getBatchImageStatuses(
  batchId: string,
  sessionUserId: string,
): Promise<Record<string, PostImageStatus>> {
  const rows = await db
    .select({
      id: postImages.id,
      postId: postImages.postId,
      status: postImages.status,
      imageUrl: postImages.imageUrl,
      attempt: postImages.attempt,
    })
    .from(postImages)
    .innerJoin(posts, eq(postImages.postId, posts.id))
    .where(and(eq(posts.batchId, batchId), eq(posts.userId, sessionUserId)));

  const out: Record<string, PostImageStatus> = {};
  for (const r of rows) {
    out[r.postId] = {
      id: r.id,
      status: r.status as PostImageStatus["status"],
      imageUrl: r.imageUrl,
      attempt: r.attempt,
    };
  }
  return out;
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
 * `input.postLength` is required (Phase 3 spec § 5.5, D7): the form layer
 * decides Pro-only visibility and submits `"medium"` for non-Pro callers.
 * The value is persisted on `weekly_batches.post_length` and forwarded to
 * the generator so the prompt's LENGTH directive is correct on first pass.
 *
 * Either the whole transaction commits or the whole thing rolls back — we
 * never persist a partial batch.
 */
export async function generateWeekly(
  userId: string,
  input: {
    theme: string;
    importantThing: string;
    postLength: PostLength;
    // Wave 1 legacy — Wave 2 derives the real count from resolveBatchPlan(now,
    // dayWindow, postingDays). Today the action still passes this for back-compat
    // under "every_day" where postCount === totalPosts === dayWindow. Wave 3
    // task 8 will remove it once generateWeeklyAction is wired to profile.postingDays.
    postCount: 7 | 9;
    // Phase 4: 1..4 for Pro batches within the current 30-day period; null
    // for Trial and Starter batches. Searching for "Pro batches" later is
    // `WHERE batch_ordinal_in_period IS NOT NULL`.
    batchOrdinalInPeriod: number | null;
    // Onboarding-posting-preferences: calendar-span size for the batch.
    // Wave 2 makes this load-bearing — it drives `resolveBatchPlan`, which
    // filters the day window down to the days `postingDays` admits. Under
    // the action's still-hardcoded `postingDays: "every_day"`,
    // `dayWindow === totalPosts === postCount`, so behaviour is byte-identical
    // to Wave 1.
    dayWindow: 7 | 9;
    // Onboarding-posting-preferences: the user's posting-days preference,
    // frozen onto the batch row at creation. Wave 2 uses this to filter the
    // calendar slot list down to working / weekend days. Caller passes
    // "every_day" as a hard-coded default until Wave 3 wires
    // profile.postingDays.
    postingDays: PostingDays;
  }
): Promise<GenerateWeeklyResult> {
  const profile = await profileService.getProfile(userId);
  if (!profile) return { ok: false, error: "no_profile" };

  const gate = await subscriptionService.canGenerate(userId);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason };
  }

  // TODO(phase-3-gating): credit gate for non-trial users will live behind
  // subscriptionService.canGenerate. Trial users are already gated by D20.

  // Calendar plan resolution (onboarding-posting-preferences §3). Under the
  // current action that passes `postingDays: "every_day"`, this is a no-op
  // filter and `totalPosts === input.dayWindow === input.postCount`. When
  // Wave 3 flips the action to pass `profile.postingDays`, this is where
  // working-days / weekends-only batches collapse to their filtered length.
  const plan = resolveBatchPlan(
    new Date(),
    input.dayWindow,
    input.postingDays
  );
  const totalPosts = plan.totalPosts;

  // Allocate the batch id BEFORE the AI call so it can seed the Mix shuffle.
  // The same id is the seed for `resolveLengthsForBatch` AND the
  // `weekly_batches.id` of the inserted row — keeping them in sync lets a
  // later single-post regenerate re-derive the exact same per-slot length
  // sequence without any DB lookup.
  const batchId = crypto.randomUUID();
  const lengths = resolveLengthsForBatch(
    totalPosts,
    input.postLength,
    batchId
  );

  // Silent AI spell-check: fix spelling mistakes in the user's typed
  // theme + importantThing without changing meaning. Failures fall
  // back to the originals — generation must not break because of this.
  // The corrected values feed BOTH the downstream AI post-generation
  // prompt and the persisted weekly_batches row so the typos never
  // surface anywhere in the system.
  const corrected = await spellCheckBatchInputs(
    input.theme,
    input.importantThing,
  );

  const generated = await postGenerator.generate({
    profile,
    theme: corrected.theme,
    importantThing: corrected.importantThing,
    lengths,
  });
  if (!generated) return { ok: false, error: "ai_failed" };

  try {
    const result = await db.transaction(async (tx) => {
      await tx.insert(weeklyBatches).values({
        id: batchId,
        userId,
        theme: corrected.theme,
        importantThing: corrected.importantThing,
        postLength: input.postLength,
        // Filtered count from the calendar plan — NOT input.postCount. The
        // two diverge once `postingDays` is anything other than "every_day".
        totalPosts,
        batchOrdinalInPeriod: input.batchOrdinalInPeriod,
        acceptedPosts: 0,
        skippedPosts: 0,
        status: "reviewing",
        dayWindow: input.dayWindow,
        postingDays: input.postingDays,
        // Image-generation Wave 1: the shared visual-style directive the
        // caption call also produced. Stored on the batch (not per-post)
        // because it's identical for every image in the set, and Wave 2's
        // retry can re-use it when re-generating a single failed image so
        // the replacement stays consistent with the surviving siblings.
        batchImageStyle: generated.batchImageStyle,
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

      // Image-generation Wave 1: pre-insert one `post_images` row per post
      // with `status="pending"`. The image-job runs AFTER this txn commits
      // (see the `after()` call below) and flips each row to either
      // `"success"` (with `imageUrl` set) or `"failed"`. Pre-inserting at
      // this point means the UI sees N placeholder rows the instant the
      // action returns — no race between user-arrives-at-review and
      // rows-don't-exist-yet. `imageUrl` is null until success (Stage 1
      // made the column nullable to support exactly this state).
      const imageRows = generated.posts.map((aiPost, i) => ({
        id: crypto.randomUUID(),
        postId: postRows[i]!.id,
        userId,
        imageUrl: null,
        imagePrompt:
          generated.batchImageStyle + " " + aiPost.imagePrompt,
        attempt: 1,
        source: "ai",
        selected: true,
        status: "pending" as const,
      }));
      await tx.insert(postImages).values(imageRows);

      return { batchId, variationsCreated: variationRows.length };
    });

    // Image-generation Wave 1: kick off the image fan-out AFTER the text
    // transaction has committed. `after()` from `next/server` defers the
    // callback until the response has been sent, so the user's HTTP
    // response unblocks immediately on text-commit (verified working in
    // Stage 0 — `markerAt - returnedAt` was +3-9ms across runs).
    //
    // `runImageGenerationForBatch` is never-throws by contract; we do NOT
    // need to wrap this call. A failure inside it logs to console and
    // leaves affected rows as `failed` or `pending`, which Wave 2's retry
    // control can recover.
    after(() => {
      imageService.runImageGenerationForBatch(result.batchId);
    });

    return {
      ok: true,
      batchId: result.batchId,
      postsCreated: totalPosts,
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
      batchId: weeklyBatches.id,
      batchStatus: weeklyBatches.status,
      batchTheme: weeklyBatches.theme,
      batchImportant: weeklyBatches.importantThing,
      batchPostLength: weeklyBatches.postLength,
      batchTotalPosts: weeklyBatches.totalPosts,
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

  // totalPosts has a NOT NULL default 7, so it is always 7 or 9 in practice.
  // Defensive narrow rejects unexpected stored values.
  const postCount: 7 | 9 = row.batchTotalPosts === 9 ? 9 : 7;

  // For a Mix batch the per-slot length is deterministic given
  // `(totalPosts, "mix", batchId)` — see `resolveLengthsForBatch`. We re-derive
  // the same array here so a regenerated post lands on the same length as the
  // original slot, keeping the batch's overall 2/3/2 (or N-table) shape intact.
  // For non-Mix batches the stored length is the per-slot length unchanged.
  const storedLength = (row.batchPostLength as PostLength | null) ?? "medium";
  let perSlotLength: Exclude<PostLength, "mix">;
  if (storedLength === "mix") {
    const lengths = resolveLengthsForBatch(
      row.batchTotalPosts,
      "mix",
      row.batchId
    );
    // postOrder is 1-indexed. Defensive fallback to "medium" if the slot
    // index ever lands out of range (should be impossible given the row
    // count was generated from this exact same plan).
    const slot = lengths[row.post.postOrder - 1];
    perSlotLength = (slot ?? "medium") as Exclude<PostLength, "mix">;
  } else {
    // Stored value is short / medium / long — the union narrows naturally
    // once "mix" is excluded.
    perSlotLength = storedLength as Exclude<PostLength, "mix">;
  }

  const result = await postGenerator.regenerateOne({
    profile,
    theme: row.batchTheme,
    importantThing: row.batchImportant,
    currentPostText: row.post.postText,
    currentHashtags: row.post.hashtags,
    feedback,
    postOrder: row.post.postOrder,
    postLength: perSlotLength,
    postCount,
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
    .where(
      and(
        eq(posts.id, postId),
        // Quota-soft-delete §4 (build audit): a tombstoned batch's selections
        // cannot be mutated. Surfaces as the existing `not_found` variant —
        // no new error code.
        isNull(weeklyBatches.deletedAt)
      )
    )
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
    .where(
      and(
        eq(weeklyBatches.id, batchId),
        // Quota-soft-delete §4 (build audit): a tombstone shares status
        // 'cancelled' with a live cancelled batch, so without this clause
        // reschedule would happily resurrect it. Surfaces as `not_found` —
        // existing variant, no new error code.
        isNull(weeklyBatches.deletedAt)
      )
    )
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
          eq(weeklyBatches.status, "cancelled"),
          // Belt-and-braces race guard: pre-read filtered, but a concurrent
          // soft-delete between the pre-read and this UPDATE would otherwise
          // resurrect a tombstone.
          isNull(weeklyBatches.deletedAt)
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
 *
 * Navigation-redesign task-06: this action also cascades the cancel onto
 * every still-`'pending'` child `scheduled_posts` row in the same
 * transaction. That unification is what lets the single-list
 * `/cancelled-posts` view (Wave 4 task-11) surface batch-cancelled posts
 * via the same `status = 'cancelled'` filter it uses for per-post cancels —
 * no UNION over parent status required. Already-`'posted'` / `'failed'`
 * rows are terminal and stay untouched.
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
    // Pre-fetch the batch's post IDs for the bulk update against
    // scheduled_posts. Done outside the transaction (read-only) so the
    // transaction itself stays tight; reusing the IDs keeps us on the
    // same `inArray(scheduledPosts.postId, postIds)` pattern used by
    // `deleteBatchForever` (post-service.ts:~1942) for consistency.
    const postRows = await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.batchId, batchId));
    const postIds = postRows.map((r) => r.id);

    const wasUpdated = await db.transaction(async (tx) => {
      const updateResult = await tx
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
        // Race: a sibling tab already flipped the status between our
        // pre-flight read and this UPDATE. The 0-row match is a no-op,
        // so there's nothing to roll back. Skip the cascade and surface
        // the right error code outside the transaction.
        return false;
      }

      // task-06: cascade cancel onto every pending child scheduled_posts
      // row. inArray with an empty array is undefined behaviour in some
      // drizzle versions, so guard the empty case.
      if (postIds.length > 0) {
        await tx
          .update(scheduledPosts)
          .set({ status: "cancelled" })
          .where(
            and(
              inArray(scheduledPosts.postId, postIds),
              eq(scheduledPosts.status, "pending")
            )
          );
      }

      return true;
    });

    if (!wasUpdated) {
      return { ok: false, error: "not_scheduling" };
    }
    return { ok: true, batchId };
  } catch (err) {
    console.error("[postService.stopBatch]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Reopen a `scheduling` batch back to `reviewing` so the user can add to,
 * remove from, or otherwise edit their `post_selections` and re-commit via
 * {@link scheduleMyPick}. Implements the "Edit selections" affordance on
 * `/posting-soon/[batchId]` (navigation-redesign post-Wave-3 fix).
 *
 * Status-guarded UPDATE is race-safe in the same way as `stopBatch` and
 * `scheduleMyPick`. The only valid prior status is `"scheduling"`:
 *  - `"reviewing"` → already editable; reopening would be a no-op.
 *  - `"cancelled"` → use {@link reschedule} instead (recovery path).
 *  - `"scheduled"` / `"completed"` → posts have already gone out (or are
 *    about to); reopen would be a footgun. Returns `not_scheduling`.
 *
 * Does NOT touch `scheduled_posts`. Stage-1 has no writer for that table
 * (BatchDetailView reads `post_selections` instead — see batch-detail-view.tsx
 * top-of-file docblock). When Phase 7's writer ships, this function will
 * likely need a sibling decision about whether to delete or flip the
 * existing `scheduled_posts` rows so the next `scheduleMyPick` rewrites
 * them cleanly; out of scope today.
 */
export async function reopenForEditing(
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
      .set({ status: "reviewing" })
      .where(
        and(
          eq(weeklyBatches.id, batchId),
          eq(weeklyBatches.status, "scheduling")
        )
      )
      .returning({ id: weeklyBatches.id });

    if (updateResult.length === 0) {
      // Race: a sibling tab flipped status between the pre-flight read and
      // this UPDATE. 0-row match is a no-op; surface as the same code
      // `stopBatch` uses for the equivalent race.
      return { ok: false, error: "not_scheduling" };
    }
    return { ok: true, batchId };
  } catch (err) {
    console.error("[postService.reopenForEditing]", err);
    return { ok: false, error: "db_failed" };
  }
}

// =============================================================================
// Per-post Cancel / Restore (D-S2-6, D-S2-7, D-S2-21 — non-destructive status
// flips on `scheduled_posts`). See the Cancel-vs-Delete contract at §0 of the
// Stage-2 spec.
// =============================================================================

/**
 * Networks a `scheduled_posts` row may target. Reused by {@link cancelPost} +
 * {@link restorePost} for the optional per-network scope. UI in Stage-2 only
 * calls these without `platform` (whole-post scope); the per-network entry
 * point is reserved for a later UI spec.
 */
type ScheduledPostPlatform = "facebook" | "instagram" | "linkedin";

/**
 * Cancel a post by flipping `scheduled_posts.status` from `'pending'` to
 * `'cancelled'` over the chosen scope (Stage-2 D-S2-6, D-S2-7).
 *
 * **Non-destructive.** The post family (`posts`, `post_variations`,
 * `post_selections`, `post_images`) is preserved — only the live schedule rows
 * flip. The image stays attached because the post still exists, so there is
 * NO call to `imageService.retainImagesToLibrary` and the image blob is not
 * touched. Reversible via {@link restorePost} (D-S2-21). True destruction is
 * the reserved future `deletePost` (D-S2-22) — see the reservation block above
 * {@link deleteBatchForever}.
 *
 * **Scope.** When `platform` is omitted, every `'pending'` `scheduled_posts`
 * row for `postId` flips — the whole-post cancel surfaced in Stage-2 UI. When
 * `platform` is supplied, only that one network's row flips — service-layer
 * support for a future per-network UI affordance (D-S2-6 §0).
 *
 * **Order:**
 *   1. Read post (ownership gate — `not_found` / `not_owned`).
 *   2. Read scheduled_posts rows in scope (availability gate D-S2-7).
 *   3. UPDATE scheduled_posts SET status='cancelled' WHERE postId = ?
 *      AND status='pending' (plus `AND platform = ?` when supplied).
 *      Returning the affected ids → `cancelledCount`.
 *
 * **Availability gate (D-S2-7)** rejects with `already_posted` when, in scope:
 *  - there is zero `scheduled_posts` rows, OR
 *  - any `scheduled_posts` row has `status='posted'`, OR
 *  - no `scheduled_posts` row has `scheduledTime > now()` AND
 *    `status='pending'` (nothing future left to cancel).
 *
 * The `.some()` checks happen JS-side so we don't need `or` from drizzle.
 */
export async function cancelPost(
  sessionUserId: string,
  postId: string,
  platform?: ScheduledPostPlatform
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
  if (post.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }

  // 2. Availability gate (D-S2-7) over the chosen scope: at least one pending
  // row with scheduledTime > now() AND no posted row. Zero rows in scope is
  // also treated as `already_posted` — the UI only surfaces the cancel action
  // for scheduled posts, so this is a defensive fallback rather than a
  // user-reachable path.
  const scopeFilter = platform
    ? and(
        eq(scheduledPosts.postId, postId),
        eq(scheduledPosts.platform, platform)
      )
    : eq(scheduledPosts.postId, postId);

  const scheduleRows = await db
    .select({
      status: scheduledPosts.status,
      scheduledTime: scheduledPosts.scheduledTime,
    })
    .from(scheduledPosts)
    .where(scopeFilter);

  const now = Date.now();
  const anyPosted = scheduleRows.some((r) => r.status === "posted");
  const anyFuturePending = scheduleRows.some(
    (r) => r.status === "pending" && r.scheduledTime.getTime() > now
  );

  if (scheduleRows.length === 0 || anyPosted || !anyFuturePending) {
    return { ok: false, error: "already_posted" };
  }

  // 3. Non-destructive status flip. No DELETE, no cascade, no image movement.
  // The `userId = sessionUserId` clause is defense in depth against a TOCTOU
  // race between the ownership read above and this UPDATE.
  try {
    const updateWhere = platform
      ? and(
          eq(scheduledPosts.postId, postId),
          eq(scheduledPosts.userId, sessionUserId),
          eq(scheduledPosts.status, "pending"),
          eq(scheduledPosts.platform, platform)
        )
      : and(
          eq(scheduledPosts.postId, postId),
          eq(scheduledPosts.userId, sessionUserId),
          eq(scheduledPosts.status, "pending")
        );

    const result = await db
      .update(scheduledPosts)
      .set({ status: "cancelled" })
      .where(updateWhere)
      .returning({ id: scheduledPosts.id });

    if (result.length === 0) {
      // Lost a race — another request flipped or posted the row(s) between
      // the gate above and this UPDATE. Mirror the gate's signal.
      return { ok: false, error: "already_posted" };
    }

    return {
      ok: true,
      batchId: post.batchId,
      cancelledCount: result.length,
    };
  } catch (err) {
    console.error("[postService.cancelPost]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Symmetric un-cancel for {@link cancelPost} (Stage-2 D-S2-21). Flips
 * `scheduled_posts.status` from `'cancelled'` back to `'pending'` over the
 * chosen scope, reversing a prior cancel.
 *
 * **No row insert, no image movement.** The `scheduled_posts` entries already
 * exist with their original `scheduledTime`s; restore just reverses the
 * status flip. The image stayed attached through the cancel, so the post
 * reappears in the network × day grid and the per-network counts without
 * any backing-data change beyond the status column.
 *
 * **Scope** mirrors {@link cancelPost}: omit `platform` to restore every
 * `'cancelled'` row for the post; supply `platform` to restore just that
 * network's row.
 *
 * **Order:**
 *   1. Read post (ownership gate — `not_found` / `not_owned`).
 *   2. Read scheduled_posts rows in scope (availability gate).
 *   3. UPDATE scheduled_posts SET status='pending' WHERE postId = ?
 *      AND status='cancelled' (plus `AND platform = ?` when supplied).
 *      Returning the affected ids → `restoredCount`.
 *
 * **Availability gate** rejects with `not_restorable` when, in scope:
 *  - there is zero `scheduled_posts` rows, OR
 *  - any `scheduled_posts` row has `status='posted'`, OR
 *  - no `'cancelled'` row has `scheduledTime > now()` (nothing future left
 *    to restore).
 */
export async function restorePost(
  sessionUserId: string,
  postId: string,
  platform?: ScheduledPostPlatform
): Promise<RestorePostResult> {
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
  if (post.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }

  // 2. Availability gate: at least one future-scheduled 'cancelled' row in
  // scope AND no 'posted' row in scope.
  const scopeFilter = platform
    ? and(
        eq(scheduledPosts.postId, postId),
        eq(scheduledPosts.platform, platform)
      )
    : eq(scheduledPosts.postId, postId);

  const scheduleRows = await db
    .select({
      status: scheduledPosts.status,
      scheduledTime: scheduledPosts.scheduledTime,
    })
    .from(scheduledPosts)
    .where(scopeFilter);

  const now = Date.now();
  const anyPosted = scheduleRows.some((r) => r.status === "posted");
  const anyFutureCancelled = scheduleRows.some(
    (r) => r.status === "cancelled" && r.scheduledTime.getTime() > now
  );

  if (scheduleRows.length === 0 || anyPosted || !anyFutureCancelled) {
    return { ok: false, error: "not_restorable" };
  }

  // 3. Symmetric status flip. The `userId = sessionUserId` clause is defense
  // in depth against a TOCTOU race between the ownership read above and
  // this UPDATE.
  try {
    const updateWhere = platform
      ? and(
          eq(scheduledPosts.postId, postId),
          eq(scheduledPosts.userId, sessionUserId),
          eq(scheduledPosts.status, "cancelled"),
          eq(scheduledPosts.platform, platform)
        )
      : and(
          eq(scheduledPosts.postId, postId),
          eq(scheduledPosts.userId, sessionUserId),
          eq(scheduledPosts.status, "cancelled")
        );

    const result = await db
      .update(scheduledPosts)
      .set({ status: "pending" })
      .where(updateWhere)
      .returning({ id: scheduledPosts.id });

    if (result.length === 0) {
      // Lost a race — another request flipped or posted the row(s) between
      // the gate above and this UPDATE. Mirror the gate's signal.
      return { ok: false, error: "not_restorable" };
    }

    return {
      ok: true,
      batchId: post.batchId,
      restoredCount: result.length,
    };
  } catch (err) {
    console.error("[postService.restorePost]", err);
    return { ok: false, error: "db_failed" };
  }
}

// =============================================================================
// Posting Soon (tabs rebuild) — per-network scheduled-posts reader + per-post
// unschedule / delete service functions.
// =============================================================================

/**
 * Per-network row shape for the `/posting-soon` tabs view.
 */
export type ScheduledPostRowData = {
  postId: string;
  batchId: string;
  platform: SelectionPlatform;
  text: string;
  imageUrl: string | null;
  scheduledTime: Date;
};

/**
 * Per-network row shape for the `/schedule-posts` tabs view. Richer than
 * `ScheduledPostRowData` because the schedule-posts row also exposes the
 * full Post (for `<EditDialog>`) and the per-post image status (for
 * `<PostTileImage>` with the Pro regenerate icon).
 */
export type UnscheduledPostRowData = {
  postId: string;
  batchId: string;
  platform: SelectionPlatform;
  text: string;
  scheduledTime: Date;
  /** Full Post row — passed to the existing `<EditDialog post={post}>` reuse. */
  post: Post;
  /** Full image status — passed to `<PostTileImage image={image}>`. */
  image: PostImageStatus | undefined;
};

/**
 * Shared per-batch group wrapper. Both `/schedule-posts` and
 * `/posting-soon` render posts grouped by batch with the batch theme +
 * important-thing as the section header (acts as a week separator).
 */
export type BatchGroup<T> = {
  batchId: string;
  batchTheme: string;
  batchImportantThing: string;
  batchCreatedAt: Date;
  rows: T[];
};

/**
 * Load every scheduled (postId, platform) row for the user, grouped by
 * platform AND by batch. Powers the `/posting-soon` tabs view. Each
 * platform's array contains one entry per `'scheduling'` batch that has
 * at least one selection on that platform; the batch header carries
 * `theme` + `importantThing` so the page renders a week separator above
 * each group.
 *
 * **Reader source — PRESENT-DAY** (mirrors `<BatchDetailView />`'s choice in
 * batch-detail-view.tsx §5.3): reads `post_selections` rather than
 * `scheduled_posts` because no writer populates `scheduled_posts` today
 * (Phase 7 cron deferred). Filtered to batches whose status is `"scheduling"`
 * so cancelled / completed / still-reviewing batches don't leak into the
 * list. Tombstones (`weekly_batches.deleted_at IS NOT NULL`) are excluded.
 *
 * `scheduledTime` is derived from `batch.createdAt + (postOrder - 1) days`
 * — the same proxy used everywhere else today. When Phase 7's writer
 * ships, swap to `scheduled_posts.scheduled_time` for the true per-post
 * time.
 *
 * Each row's `text` is the per-platform text: `posts.postText` (canonical
 * Facebook) for FB, `post_variations.postText` for IG / LI. Falls back to
 * the canonical when no variation row exists (Starter users).
 *
 * Within each batch, rows are ordered by `scheduledTime` ascending.
 * Batches are ordered by `batch.createdAt` ascending across all batches.
 */
export async function getAllScheduledPostsForUser(
  userId: string
): Promise<Record<SelectionPlatform, BatchGroup<ScheduledPostRowData>[]>> {
  const out: Record<SelectionPlatform, BatchGroup<ScheduledPostRowData>[]> = {
    facebook: [],
    instagram: [],
    linkedin: [],
  };

  const rows = await db
    .select({
      postId: posts.id,
      batchId: posts.batchId,
      postOrder: posts.postOrder,
      postText: posts.postText,
      batchTheme: weeklyBatches.theme,
      batchImportantThing: weeklyBatches.importantThing,
      batchCreatedAt: weeklyBatches.createdAt,
      platform: postSelections.platform,
      variationText: postVariations.postText,
      imageUrl: postImages.imageUrl,
    })
    .from(postSelections)
    .innerJoin(posts, eq(posts.id, postSelections.postId))
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .leftJoin(
      postVariations,
      and(
        eq(postVariations.postId, posts.id),
        eq(postVariations.platform, postSelections.platform)
      )
    )
    .leftJoin(postImages, eq(postImages.postId, posts.id))
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        eq(weeklyBatches.status, "scheduling"),
        isNull(weeklyBatches.deletedAt)
      )
    );

  // Per-platform map: batchId → BatchGroup. Built up as we walk the rows
  // so we materialise one BatchGroup per (platform, batch) only the
  // first time we see a row for that combo.
  const groupsByPlatform: Record<
    SelectionPlatform,
    Map<string, BatchGroup<ScheduledPostRowData>>
  > = {
    facebook: new Map(),
    instagram: new Map(),
    linkedin: new Map(),
  };

  for (const r of rows) {
    const platform = r.platform as SelectionPlatform;
    if (!(platform in groupsByPlatform)) continue;

    const scheduledTime = new Date(r.batchCreatedAt);
    scheduledTime.setDate(scheduledTime.getDate() + (r.postOrder - 1));
    const text =
      platform === "facebook"
        ? r.postText
        : r.variationText ?? r.postText;

    let group = groupsByPlatform[platform].get(r.batchId);
    if (!group) {
      group = {
        batchId: r.batchId,
        batchTheme: r.batchTheme,
        batchImportantThing: r.batchImportantThing,
        batchCreatedAt: r.batchCreatedAt,
        rows: [],
      };
      groupsByPlatform[platform].set(r.batchId, group);
    }
    group.rows.push({
      postId: r.postId,
      batchId: r.batchId,
      platform,
      text,
      imageUrl: r.imageUrl,
      scheduledTime,
    });
  }

  // Flatten + sort. Within a group, rows ascend by scheduledTime; across
  // groups, batches ascend by batchCreatedAt.
  for (const platform of Object.keys(groupsByPlatform) as SelectionPlatform[]) {
    const arr = Array.from(groupsByPlatform[platform].values());
    for (const group of arr) {
      group.rows.sort(
        (a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime()
      );
    }
    arr.sort(
      (a, b) => a.batchCreatedAt.getTime() - b.batchCreatedAt.getTime()
    );
    out[platform] = arr;
  }

  return out;
}

/**
 * Per-network unscheduled-posts reader for the `/schedule-posts` tabs
 * view. Returns every `(post, platform)` combo that has NO
 * `post_selections` row, across BOTH `'reviewing'` and `'scheduling'`
 * batches — perfect mirror of {@link getAllScheduledPostsForUser}.
 *
 * The schedule-posts row needs richer data than the posting-soon row:
 *  - Full `Post` for the existing `<EditDialog post={post}>` reuse.
 *  - Full `PostImageStatus` for `<PostTileImage>` rendering (Pro users
 *    get the corner regenerate icon automatically).
 *
 * Filter to `(postId, platform)` combos with no selection: we fetch
 * every existing `post_selections` row for the candidate posts into a
 * Set keyed by `${postId}:${platform}` and skip any combo that hits.
 *
 * Grouped by platform AND by batch — every platform's array contains
 * one entry per batch that has at least one unscheduled combo on that
 * platform; the batch header carries `theme` + `importantThing` for
 * the week-separator UI.
 *
 * Ordering: within a batch, rows ascend by `scheduledTime`; across
 * batches, ascending by `batchCreatedAt`.
 */
export async function getAllUnscheduledPostsForUser(
  userId: string,
  platforms: SelectionPlatform[]
): Promise<Record<SelectionPlatform, BatchGroup<UnscheduledPostRowData>[]>> {
  const out: Record<SelectionPlatform, BatchGroup<UnscheduledPostRowData>[]> = {
    facebook: [],
    instagram: [],
    linkedin: [],
  };

  if (platforms.length === 0) return out;

  // 1. Matching batches (reviewing OR scheduling, not tombstoned).
  const batchRows = await db
    .select()
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        inArray(weeklyBatches.status, ["reviewing", "scheduling"]),
        isNull(weeklyBatches.deletedAt)
      )
    );

  if (batchRows.length === 0) return out;

  const batchIds = batchRows.map((b) => b.id);
  const batchById = new Map(batchRows.map((b) => [b.id, b]));

  // 2. All posts in those batches (full Post rows, ready to pass to
  //    `<EditDialog post={post}>` verbatim).
  const postRows = await db
    .select()
    .from(posts)
    .where(inArray(posts.batchId, batchIds));

  if (postRows.length === 0) return out;

  const postIds = postRows.map((p) => p.id);

  // 3. Variations for IG / LI per-platform text.
  const variationRows = await db
    .select({
      postId: postVariations.postId,
      platform: postVariations.platform,
      text: postVariations.postText,
    })
    .from(postVariations)
    .where(inArray(postVariations.postId, postIds));
  const variationByPostPlatform = new Map<string, string>();
  for (const v of variationRows) {
    variationByPostPlatform.set(`${v.postId}:${v.platform}`, v.text);
  }

  // 4. Images for `<PostTileImage>` (status + URL + attempt + id).
  const imageRows = await db
    .select({
      id: postImages.id,
      postId: postImages.postId,
      status: postImages.status,
      imageUrl: postImages.imageUrl,
      attempt: postImages.attempt,
    })
    .from(postImages)
    .where(inArray(postImages.postId, postIds));
  const imageByPost = new Map<string, PostImageStatus>();
  for (const img of imageRows) {
    imageByPost.set(img.postId, {
      id: img.id,
      status: img.status as PostImageStatus["status"],
      imageUrl: img.imageUrl,
      attempt: img.attempt,
    });
  }

  // 5. Existing `post_selections` — used to FILTER OUT already-scheduled
  //    combos. Set keyed by `${postId}:${platform}` for O(1) lookup
  //    inside the cross-product loop.
  const selectionRows = await db
    .select({
      postId: postSelections.postId,
      platform: postSelections.platform,
    })
    .from(postSelections)
    .where(inArray(postSelections.postId, postIds));
  const selectedSet = new Set<string>();
  for (const sel of selectionRows) {
    selectedSet.add(`${sel.postId}:${sel.platform}`);
  }

  // 6. Walk posts × platforms; emit one row per combo with no selection.
  //    Group materialises lazily on first hit per (platform, batch).
  const groupsByPlatform: Record<
    SelectionPlatform,
    Map<string, BatchGroup<UnscheduledPostRowData>>
  > = {
    facebook: new Map(),
    instagram: new Map(),
    linkedin: new Map(),
  };

  for (const post of postRows) {
    const batch = batchById.get(post.batchId);
    if (!batch) continue; // defensive — batch was filtered above
    const scheduledTime = new Date(batch.createdAt);
    scheduledTime.setDate(scheduledTime.getDate() + (post.postOrder - 1));
    const image = imageByPost.get(post.id);

    for (const platform of platforms) {
      if (!(platform in groupsByPlatform)) continue;
      const key = `${post.id}:${platform}`;
      if (selectedSet.has(key)) continue; // already scheduled — skip

      const text =
        platform === "facebook"
          ? post.postText
          : variationByPostPlatform.get(key) ?? post.postText;

      let group = groupsByPlatform[platform].get(batch.id);
      if (!group) {
        group = {
          batchId: batch.id,
          batchTheme: batch.theme,
          batchImportantThing: batch.importantThing,
          batchCreatedAt: batch.createdAt,
          rows: [],
        };
        groupsByPlatform[platform].set(batch.id, group);
      }
      group.rows.push({
        postId: post.id,
        batchId: batch.id,
        platform,
        text,
        scheduledTime,
        post,
        image,
      });
    }
  }

  // 7. Flatten + sort. Within a group, rows ascend by scheduledTime;
  //    across groups, batches ascend by batchCreatedAt.
  for (const platform of Object.keys(groupsByPlatform) as SelectionPlatform[]) {
    const arr = Array.from(groupsByPlatform[platform].values());
    for (const group of arr) {
      group.rows.sort(
        (a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime()
      );
    }
    arr.sort(
      (a, b) => a.batchCreatedAt.getTime() - b.batchCreatedAt.getTime()
    );
    out[platform] = arr;
  }

  return out;
}

/**
 * Per-network instant Schedule for the `/schedule-posts` tabs view —
 * symmetric counterpart to {@link unschedulePostForNetwork}.
 *
 * Inserts a `post_selections` row for `(postId, platform)` with
 * `ON CONFLICT DO NOTHING` (idempotent — repeated clicks land cleanly).
 * If the parent batch is currently `'reviewing'`, the same transaction
 * flips it to `'scheduling'` so the new selection immediately surfaces
 * on `/posting-soon` (which filters by `'scheduling'` status).
 *
 * Bypasses `loadPostForSelectionMutation`'s status guard — rows on
 * `/schedule-posts` come from batches in EITHER status, and the action
 * must work for both. Ownership is enforced via the `posts.userId`
 * join on the pre-flight read.
 */
export async function scheduleForNetwork(
  postId: string,
  platform: SelectionPlatform,
  sessionUserId: string
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "db_failed" }
> {
  const [row] = await db
    .select({
      userId: posts.userId,
      batchId: posts.batchId,
      batchStatus: weeklyBatches.status,
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

  try {
    await db.transaction(async (tx) => {
      // 1. Idempotent insert. `(postId, platform)` is uniquely indexed
      //    by the schema (`post_selections_post_platform_unique`), so
      //    `ON CONFLICT DO NOTHING` collapses re-clicks to a no-op.
      await tx
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

      // 2. Auto-flip `'reviewing'` → `'scheduling'` so the new selection
      //    immediately appears on `/posting-soon`. Status-guarded UPDATE
      //    is race-safe: if another transaction already flipped the
      //    status, our WHERE matches zero rows and is a no-op.
      if (row.batchStatus === "reviewing") {
        await tx
          .update(weeklyBatches)
          .set({ status: "scheduling" })
          .where(
            and(
              eq(weeklyBatches.id, row.batchId),
              eq(weeklyBatches.status, "reviewing")
            )
          );
      }
    });
    return { ok: true };
  } catch (err) {
    console.error("[postService.scheduleForNetwork]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Bulk Schedule-all for a platform. Inserts `post_selections` rows for
 * every `(post, platform)` combo the user owns that doesn't already
 * have one for `platform`, across all `'reviewing'`/`'scheduling'`
 * batches. Single transaction; auto-flips any `'reviewing'` batches
 * that were touched to `'scheduling'`.
 *
 * Returns the count of rows actually inserted so the UI toast can say
 * "Scheduled N Facebook posts."
 */
export async function bulkScheduleAllUnscheduledForNetwork(
  sessionUserId: string,
  platform: SelectionPlatform
): Promise<
  | { ok: true; added: number }
  | { ok: false; error: "db_failed" }
> {
  try {
    // 1. Pre-flight read OUTSIDE the transaction: every (postId, batchId)
    //    combo the user owns in an open batch, with the post-selection
    //    state for THIS platform. Same multi-step pattern
    //    `getAllUnscheduledPostsForUser` uses; keeps the transaction
    //    tight to the actual writes.
    const candidateRows = await db
      .select({
        postId: posts.id,
        batchId: posts.batchId,
        batchStatus: weeklyBatches.status,
      })
      .from(posts)
      .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
      .where(
        and(
          eq(weeklyBatches.userId, sessionUserId),
          inArray(weeklyBatches.status, ["reviewing", "scheduling"]),
          isNull(weeklyBatches.deletedAt)
        )
      );

    if (candidateRows.length === 0) return { ok: true, added: 0 };

    const candidatePostIds = candidateRows.map((r) => r.postId);

    const existingSelections = await db
      .select({ postId: postSelections.postId })
      .from(postSelections)
      .where(
        and(
          inArray(postSelections.postId, candidatePostIds),
          eq(postSelections.platform, platform)
        )
      );
    const alreadySelected = new Set(existingSelections.map((s) => s.postId));

    const toInsert = candidateRows.filter(
      (r) => !alreadySelected.has(r.postId)
    );
    if (toInsert.length === 0) return { ok: true, added: 0 };

    // Batch ids that need a status flip ('reviewing' → 'scheduling').
    const reviewingBatchIds = Array.from(
      new Set(
        toInsert
          .filter((r) => r.batchStatus === "reviewing")
          .map((r) => r.batchId)
      )
    );

    // 2. One transaction: insert all selections, then flip any
    //    reviewing batches that gained selections.
    await db.transaction(async (tx) => {
      await tx
        .insert(postSelections)
        .values(
          toInsert.map((r) => ({
            id: crypto.randomUUID(),
            postId: r.postId,
            userId: sessionUserId,
            platform,
          }))
        )
        .onConflictDoNothing({
          target: [postSelections.postId, postSelections.platform],
        });

      if (reviewingBatchIds.length > 0) {
        await tx
          .update(weeklyBatches)
          .set({ status: "scheduling" })
          .where(
            and(
              inArray(weeklyBatches.id, reviewingBatchIds),
              eq(weeklyBatches.status, "reviewing")
            )
          );
      }
    });

    return { ok: true, added: toInsert.length };
  } catch (err) {
    console.error("[postService.bulkScheduleAllUnscheduledForNetwork]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Per-network unschedule from `/posting-soon`. Deletes the
 * `post_selections` row for (postId, platform) so the post stops appearing
 * in that network's tab. The post itself stays in the batch — other
 * networks' selections (if any) are untouched.
 *
 * **Empty-batch fall-back to `reviewing`:** when removing this selection
 * leaves the batch with zero `post_selections` rows across all its posts,
 * the same transaction flips `weekly_batches.status` from `scheduling` →
 * `reviewing`. That makes the batch reappear on `/schedule-posts` so the
 * user can edit and re-commit it. Without this, an unschedule-everything
 * sequence would leave the batch in `scheduling` status with nothing to
 * post — invisible everywhere except via direct URL.
 *
 * Unlike `deselectForNetwork`, this function does NOT call
 * `loadPostForSelectionMutation` because that guard restricts mutation to
 * batches in `reviewing` or `cancelled` status. Posts on `/posting-soon`
 * are by definition in `scheduling` batches — so we run our own
 * lightweight ownership check via the `posts.userId` join and skip the
 * status gate entirely.
 */
export async function unschedulePostForNetwork(
  postId: string,
  platform: SelectionPlatform,
  sessionUserId: string
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "db_failed" }
> {
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

  const { batchId } = row;

  try {
    await db.transaction(async (tx) => {
      // 1. Delete the (postId, platform) selection.
      await tx
        .delete(postSelections)
        .where(
          and(
            eq(postSelections.postId, postId),
            eq(postSelections.platform, platform)
          )
        );

      // 2. Count remaining selections across every post in this batch.
      //    If the row we just deleted was the last one for the batch,
      //    the batch should fall back to `reviewing` so it reappears on
      //    `/schedule-posts`.
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(postSelections)
        .innerJoin(posts, eq(posts.id, postSelections.postId))
        .where(eq(posts.batchId, batchId));
      const remaining = countRow?.count ?? 0;

      // 3. Status-guarded flip back to `reviewing`. The `status =
      //    'scheduling'` clause makes this race-safe: a concurrent
      //    `stopBatch` (→ `cancelled`) or `reopenForEditing` (→
      //    `reviewing` already) matches zero rows here, so we never
      //    stomp another transition's outcome.
      if (remaining === 0) {
        await tx
          .update(weeklyBatches)
          .set({ status: "reviewing" })
          .where(
            and(
              eq(weeklyBatches.id, batchId),
              eq(weeklyBatches.status, "scheduling")
            )
          );
      }
    });
    return { ok: true };
  } catch (err) {
    console.error("[postService.unschedulePostForNetwork]", err);
    return { ok: false, error: "db_failed" };
  }
}

/**
 * Per-post hard delete with image preservation (implements the previously
 * RESERVED D-S2-22 contract). Used by the `/posting-soon` per-row Delete
 * button.
 *
 * Step order mirrors {@link deleteBatchForever}, applied at the post level:
 *   1. Ownership lookup against `posts.userId`. Status is NOT gated —
 *      deletion is allowed regardless of batch status because the action
 *      is destructive by intent (matches "delete forever" semantics).
 *   2. `imageService.retainImagesToLibrary([postId])` moves the post's
 *      image blob into the user's library before we drop the parent row.
 *   3. Transaction: explicit bottom-up child-row deletes (scheduled_posts
 *      → post_selections → post_variations → post_images) then the parent
 *      `posts` row. The image-blob row's removal in step 3 is a dead
 *      reference because the blob is now owned by `library_images`.
 *
 * Returns `{ ok: false, error: "not_found" }` for both genuine not-found
 * and tombstoned-batch cases — caller doesn't need to distinguish.
 */
export async function deletePost(
  postId: string,
  sessionUserId: string
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "db_failed" }
> {
  const [row] = await db
    .select({ userId: posts.userId, batchDeletedAt: weeklyBatches.deletedAt })
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

  // Preserve the image to the user's library before deleting the post.
  // `retainImagesToLibrary` short-circuits when no successful image exists
  // for the post — safe to call unconditionally.
  const retain = await imageService.retainImagesToLibrary(sessionUserId, [
    postId,
  ]);
  if (!retain.ok) {
    return { ok: false, error: retain.error };
  }

  try {
    await db.transaction(async (tx) => {
      // Bottom-up child deletes — foreign keys release cleanly working
      // from leaves toward the parent.
      await tx
        .delete(scheduledPosts)
        .where(eq(scheduledPosts.postId, postId));
      await tx
        .delete(postSelections)
        .where(eq(postSelections.postId, postId));
      await tx
        .delete(postVariations)
        .where(eq(postVariations.postId, postId));
      await tx.delete(postImages).where(eq(postImages.postId, postId));
      await tx
        .delete(posts)
        .where(and(eq(posts.id, postId), eq(posts.userId, sessionUserId)));
    });
    return { ok: true };
  } catch (err) {
    console.error("[postService.deletePost]", err);
    return { ok: false, error: "db_failed" };
  }
}

// =============================================================================
// deleteBatchForever — hard-delete a cancelled batch with image preservation
// (D-S2-8). Companion to cancelPost: same retain-then-delete order, applied at
// the batch level. Reviewing batches use the wizard discard flow, not this.
// =============================================================================

export type DeleteBatchForeverResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "not_cancelled" | "db_failed";
    };

/**
 * Soft-delete a cancelled batch with image preservation (D-S2-8 +
 * quota-soft-delete §3). The `weekly_batches` row stays as a tombstone with
 * `deleted_at` set; every child row is hard-deleted; the user never sees the
 * batch again. Quota gates in `subscription-service.ts` continue to count
 * the tombstone, so a delete never refunds a slot — that's the whole point
 * of this wave.
 *
 * Step order:
 *   1. Read batch (ownership + status gate, including `deleted_at IS NULL` —
 *      a re-call on an already-tombstoned batch returns `not_found` cheaply
 *      without wasting child-row queries).
 *   2. Read postIds (could be 0 if every post was cancelled individually
 *      first).
 *   3. Preserve images via image-service (per-user advisory lock and the
 *      30-image cap eviction live there).
 *   4. Single transaction:
 *      - Explicit bottom-up child-row DELETEs: scheduled_posts →
 *        post_selections → post_variations → post_images → posts. Image
 *        blobs were already moved to library_images by step 3, so the
 *        post_images row deletion drops dead references only.
 *      - UPDATE weekly_batches SET deleted_at = now() with the load-bearing
 *        `deleted_at IS NULL` guard. Per spec §3, deleted_at records the
 *        FIRST moment of deletion and is never re-stamped — a concurrent
 *        re-call matches zero rows and surfaces the existing `not_found`
 *        variant.
 *
 * Only `status = 'cancelled'` batches qualify. Reviewing batches go through
 * the wizard discard flow, which has its own confirmation copy.
 */
export async function deleteBatchForever(
  sessionUserId: string,
  batchId: string
): Promise<DeleteBatchForeverResult> {
  // 1. Ownership + status gate. Tombstones return `not_found` here so we
  // skip the children query + image-preservation round trip on re-calls.
  // Step 4's UPDATE is still the authoritative race guard.
  const [batch] = await db
    .select({
      userId: weeklyBatches.userId,
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.id, batchId),
        isNull(weeklyBatches.deletedAt)
      )
    )
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) {
    return { ok: false, error: "not_owned" };
  }
  if (batch.status !== "cancelled") {
    return { ok: false, error: "not_cancelled" };
  }

  // 2. Collect post IDs. Legitimately empty when the user cancelled every
  // post individually before clicking "Delete forever" on the batch card.
  const postRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.batchId, batchId));

  const postIds = postRows.map((r) => r.id);

  // 3. Preserve images. Skip the call entirely on empty input — image-service
  // would short-circuit anyway, but avoiding the round-trip keeps the empty
  // path cheap.
  if (postIds.length > 0) {
    const retain = await imageService.retainImagesToLibrary(
      sessionUserId,
      postIds
    );
    if (!retain.ok) {
      // `not_owned` here would mean a row's userId drifted between our batch
      // read and image-service's per-post check — surface the same code for
      // the UI toast.
      return { ok: false, error: retain.error };
    }
  }

  // 4. Atomic child-row cleanup + tombstone write. The `deleted_at IS NULL`
  // clause on the UPDATE is the load-bearing race guard from spec §3:
  // concurrent re-calls match zero rows and the function surfaces the
  // existing `not_found` variant.
  try {
    const updated = await db.transaction(async (tx) => {
      // Bottom-up child deletes per spec §3 — foreign keys release cleanly
      // as we work from leaves toward the parent. inArray with an empty
      // array is undefined behaviour in some drizzle versions, so we guard
      // the postId-keyed deletes; deleting from `posts` by `batchId` is
      // already a no-op when there are no rows.
      if (postIds.length > 0) {
        await tx
          .delete(scheduledPosts)
          .where(inArray(scheduledPosts.postId, postIds));
        await tx
          .delete(postSelections)
          .where(inArray(postSelections.postId, postIds));
        await tx
          .delete(postVariations)
          .where(inArray(postVariations.postId, postIds));
        await tx
          .delete(postImages)
          .where(inArray(postImages.postId, postIds));
        await tx.delete(posts).where(eq(posts.batchId, batchId));
      }

      return tx
        .update(weeklyBatches)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(weeklyBatches.id, batchId),
            eq(weeklyBatches.userId, sessionUserId),
            eq(weeklyBatches.status, "cancelled"),
            isNull(weeklyBatches.deletedAt)
          )
        )
        .returning({ id: weeklyBatches.id });
    });

    if (updated.length === 0) {
      // Lost a race — concurrent soft-delete, status flip, or the row
      // vanished between the pre-read and the UPDATE. The transaction
      // committed (children may have been deleted), but the parent
      // tombstone was already written by the racing call. Idempotent from
      // the caller's perspective.
      return { ok: false, error: "not_found" };
    }

    return { ok: true };
  } catch (err) {
    console.error("[postService.deleteBatchForever]", err);
    return { ok: false, error: "db_failed" };
  }
}
