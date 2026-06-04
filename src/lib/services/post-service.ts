import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import * as postGenerator from "@/lib/ai/post-generator";
import { db } from "@/lib/db";
import {
  type NewPostVariation,
  type Post,
  type PostLength,
  type PostVariation,
  type SelectionPlatform,
  type WeeklyBatch,
  postSelections,
  postVariations,
  posts,
  scheduledPosts,
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
  status: "reviewing" | "cancelled";
  counts: { facebook: number; instagram: number; linkedin: number };
};

/**
 * Box-shaped data for a single "current period" batch on the Scheduled page.
 * Returned inside {@link ScheduledView.current} by
 * {@link getScheduledViewForUser}; consumed by `<ScheduledBatchBox />`.
 *
 * Stage-1 dormant contract — three fields ride along today as safe defaults
 * but will activate when Phase 4 (`scheduleService`) and Phase 7
 * (`postingService`) ship without any component changes:
 *  - `derivedState`: always `"upcoming"` in Stage-1. Phase 4 flips it to
 *    `"currently_posting"` when `scheduled_posts` rows exist for the batch
 *    with `status='posted'` AND at least one row is still `status='pending'`
 *    with `scheduledTime > now()`.
 *  - `alreadyPostedCount`: always `0` in Stage-1. Phase 7 populates with
 *    `COUNT(scheduled_posts.status='posted')` per batch.
 *  - `queuedCount`: always equal to `totalPosts` in Stage-1. Phase 7 sets it
 *    to `totalPosts - alreadyPostedCount`.
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
  totalPosts: number;
  counts: { facebook: number; instagram: number; linkedin: number };
  // Stage-1 dormant: see type-level docblock above.
  derivedState: "upcoming" | "currently_posting";
  // Stage-1 dormant: see type-level docblock above.
  alreadyPostedCount: number;
  // Stage-1 dormant: see type-level docblock above.
  queuedCount: number;
  /**
   * Stage-2 D-S2-12. 7 entries, post_order 1..7. `status` is:
   *  - `"scheduled"`: a post row exists for this ordinal and no
   *    `scheduled_posts` row for it has `status='posted'`.
   *  - `"cancelled"`: no post row exists for this ordinal (per-post cancel
   *    or the user de-selected the slot before scheduling).
   *  - `"posted"`:   Phase-7 dormant. Stage-2 never produces this value.
   *
   * `date` is the earliest `scheduledPosts.scheduledTime` for that post, or
   * a derived day-offset from `weeklyBatches.createdAt` when no schedule
   * row exists yet (Stage-1 batches before Phase-4's `scheduleService.create`
   * exists). `label` is the short weekday like `"Mon"`.
   */
  days: Array<{
    label: string;
    date: Date;
    status: "scheduled" | "cancelled" | "posted";
  }>;
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
        inArray(weeklyBatches.status, ["reviewing", "scheduling"])
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return batch ?? null;
}

/**
 * Most recent batch in any *resumable* status — `reviewing`, `scheduling`,
 * `scheduled`, or `cancelled`. Used by `/posts` when no `?batchId=` query
 * param is supplied (sidebar "My Posts" link, the QuotaGatedScreen's
 * "Return to your current batch" CTA).
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
        ])
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
      status: weeklyBatches.status,
    })
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, userId),
        inArray(weeklyBatches.status, ["reviewing", "cancelled"])
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
 * Short weekday labels, indexed by `Date.prototype.getDay()` (0 = Sunday).
 * Used by `getScheduledViewForUser` to label the 7-day strip cells for each
 * box (D-S2-12). Server-local timezone — task-13's UI component re-derives
 * client-side if a user-tz label is ever needed.
 */
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Milliseconds per day. Used only for the day-offset fallback when a post
 * exists but has no `scheduled_posts` row yet (Stage-1 batches before
 * Phase-4's `scheduleService.create` runs).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Data bundle for the Scheduled page (Stage-2 rewrite — D-S2-11, D-S2-12).
 *
 * Returns the user's rolling-4 batches: at most 4 rows in
 * `status IN ('scheduling', 'completed')`, sorted `createdAt DESC` so the
 * newest occupies the first 2x2 grid cell. The Stage-1 period window
 * (`periodStartDate` / `periodEndsAt`) is gone — the schedule-service's
 * rolling-4 eviction enforces the cap upstream, so this read just trusts
 * `LIMIT 4`.
 *
 * Each `BatchBoxData` carries a `days[]` array describing the 7-day strip:
 *  - One cell per `posts.postOrder` 1..7 (no compaction; cancelled slots
 *    remain in place).
 *  - `status='scheduled'` when a `posts` row exists for that ordinal.
 *  - `status='cancelled'` when the post row is gone (per-post cancel or the
 *    user de-selected before scheduling).
 *  - `status='posted'` is reserved for Phase 7 — Stage-2 never produces it.
 *  - `date` is the earliest `scheduled_posts.scheduledTime` per post; falls
 *    back to `batch.createdAt + (ordinal - 1) days` when no schedule row
 *    exists yet.
 *
 * Stage-1 dormant fields (`derivedState`, `alreadyPostedCount`, `queuedCount`)
 * still default to the safe values documented on {@link BatchBoxData} — Phase
 * 4/7 will compute real values without touching this function's signature.
 *
 * Query plan (3 queries, no N+1):
 *  1. Top-4 batches by `createdAt DESC` filtered to `status IN ('scheduling',
 *     'completed')` for `userId`.
 *  2. Per-network selection counts via {@link loadSelectionCounts}.
 *  3. Posts + earliest `scheduledPosts.scheduledTime` per post (left-joined,
 *     grouped by post) for the same batch ids.
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
        inArray(weeklyBatches.status, ["scheduling", "completed"])
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(4);

  if (rows.length === 0) {
    return { current: [], scheduledBatchCount: 0 };
  }

  const batchIds = rows.map((r) => r.id);

  // Per-batch network counts (reuses the existing private helper — it
  // pre-seeds every batch id with `{ facebook: 0, instagram: 0, linkedin: 0 }`
  // so the lookup below never needs a nullish fallback at runtime).
  const countsByBatch = await loadSelectionCounts(batchIds);

  // One query for posts + earliest scheduled time per post. A post can have
  // 1–3 `scheduled_posts` rows (one per selected network); `MIN(scheduledTime)`
  // collapses them to the earliest. `leftJoin` keeps posts that don't yet
  // have schedule rows (Stage-1 batches before Phase-4's `scheduleService`)
  // — `earliestScheduledTime` is `null` for those and the fallback date below
  // takes over.
  const postRows = await db
    .select({
      batchId: posts.batchId,
      postId: posts.id,
      postOrder: posts.postOrder,
      earliestScheduledTime: sql<
        Date | null
      >`MIN(${scheduledPosts.scheduledTime})`,
    })
    .from(posts)
    .leftJoin(scheduledPosts, eq(scheduledPosts.postId, posts.id))
    .where(inArray(posts.batchId, batchIds))
    .groupBy(posts.batchId, posts.id, posts.postOrder);

  // Index posts by batch → postOrder so the days[] build below is O(1) per
  // ordinal rather than O(n) over the flat row list.
  const postsByBatch = new Map<string, Map<number, { date: Date | null }>>();
  for (const id of batchIds) {
    postsByBatch.set(id, new Map());
  }
  for (const p of postRows) {
    // Defensive: posts.batchId is non-null at the schema level, but the
    // projection types it as nullable. Skip the (impossible) null case
    // rather than assert with `!`.
    if (!p.batchId) continue;
    const bucket = postsByBatch.get(p.batchId);
    if (!bucket) continue;
    bucket.set(p.postOrder, { date: p.earliestScheduledTime ?? null });
  }

  const current: BatchBoxData[] = rows.map((r) => {
    const postMap = postsByBatch.get(r.id) ?? new Map();

    const days: BatchBoxData["days"] = [];
    for (let ordinal = 1; ordinal <= 7; ordinal++) {
      const entry = postMap.get(ordinal);
      // Fallback when no `scheduled_posts` row exists for a still-extant
      // post: lay the strip out as `batch.createdAt + (ordinal - 1) days`.
      // Purely cosmetic — task-13's <SevenDayStrip /> only reads `date` for
      // the weekday label.
      const fallback = new Date(
        r.createdAt.getTime() + (ordinal - 1) * DAY_MS
      );
      const date = entry?.date ?? fallback;
      // Stage-2 binary: post row present ⇒ scheduled, missing ⇒ cancelled.
      // `'posted'` is Phase-7 only and never produced here.
      const status: "scheduled" | "cancelled" | "posted" = entry
        ? "scheduled"
        : "cancelled";
      days.push({
        label: WEEKDAY_LABELS[date.getDay()] ?? "",
        date,
        status,
      });
    }

    return {
      id: r.id,
      ordinal: r.ordinal,
      theme: r.theme,
      importantThing: r.importantThing,
      totalPosts: r.totalPosts,
      counts: countsByBatch.get(r.id) ?? {
        facebook: 0,
        instagram: 0,
        linkedin: 0,
      },
      // Stage-1 dormant defaults unchanged — Phase 4/7 still owns the flip.
      derivedState: "upcoming" as const,
      alreadyPostedCount: 0,
      queuedCount: r.totalPosts,
      days,
    };
  });

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
    // Phase 4: 7 for trial / Starter / Pro batches 1–3; 9 for the Pro monthly
    // bonus (batch 4 in a 30-day window). Caller (/create server action)
    // computes and trusts the value — single-responsibility.
    postCount: 7 | 9;
    // Phase 4: 1..4 for Pro batches within the current 30-day period; null
    // for Trial and Starter batches. Searching for "Pro batches" later is
    // `WHERE batch_ordinal_in_period IS NOT NULL`.
    batchOrdinalInPeriod: number | null;
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

  const generated = await postGenerator.generate({
    profile,
    theme: input.theme,
    importantThing: input.importantThing,
    postLength: input.postLength,
    postCount: input.postCount,
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
        postLength: input.postLength,
        totalPosts: input.postCount,
        batchOrdinalInPeriod: input.batchOrdinalInPeriod,
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
      postsCreated: input.postCount,
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

  const result = await postGenerator.regenerateOne({
    profile,
    theme: row.batchTheme,
    importantThing: row.batchImportant,
    currentPostText: row.post.postText,
    currentHashtags: row.post.hashtags,
    feedback,
    postOrder: row.post.postOrder,
    postLength: (row.batchPostLength as PostLength | null) ?? "medium",
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
