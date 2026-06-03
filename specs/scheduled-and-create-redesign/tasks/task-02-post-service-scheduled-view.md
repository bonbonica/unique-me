# Task 02: postService.getScheduledViewForUser

## Status
not started

## Wave
1

## Description

Add a new service-layer function that returns everything the Scheduled page needs to render: current-period scheduling batches (boxes) + current-period completed batches (past rows) + the period window dates. The Stage-1 shape carries dormant fields (`derivedState`, `alreadyPostedCount`, `queuedCount`) that always return safe defaults today but will activate when Phase 4 + Phase 7 ship — no component changes needed at that point.

## Dependencies

**Depends on:** none.
**Blocks:** task-08 (ScheduledBatchBox prop wiring), task-11 (page-level data fetch).
**Parallel with:** task-01 (same file; split regions to avoid conflict).

## Files to Modify

- `src/lib/services/post-service.ts` (modified) — add the export and helper types.
- `src/lib/services/subscription-service.ts` (modified — only if `periodStartDate` / `periodEndsAt` are not already on the snapshot for non-Pro plans).

## Implementation Steps

### 1. Add the return types

```ts
export type BatchBoxData = {
  id: string;
  ordinal: number | null;
  theme: string;
  importantThing: string;
  totalPosts: number;
  counts: { facebook: number; instagram: number; linkedin: number };
  // Stage-1: always "upcoming". Phase 4 flips to "currently_posting" when
  // scheduled_posts rows exist for the batch with status='posted' AND at
  // least one row with status='pending' AND scheduledTime > now().
  derivedState: "upcoming" | "currently_posting";
  // Stage-1: always 0. Phase 7 fills with COUNT(scheduled_posts.status='posted').
  alreadyPostedCount: number;
  // Stage-1: always === totalPosts. Phase 7 fills with totalPosts - alreadyPostedCount.
  queuedCount: number;
};

export type PastBatchRow = {
  id: string;
  ordinal: number | null;
  theme: string;
  totalPosts: number;
  completedAt: Date;
};

export type ScheduledView = {
  current: BatchBoxData[];
  past: PastBatchRow[];
  periodStartDate: Date;
  periodEndsAt: Date;
};
```

### 2. Compute the period window

Reuse the rolling-30-day anchor formula already in `subscription-service.ts` (Phase 4 D-A11):

```ts
function computeCurrentPeriodStart(anchor: Date, now: Date): Date {
  const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
  const elapsed = now.getTime() - anchor.getTime();
  if (elapsed < 0) return anchor;
  const periods = Math.floor(elapsed / PERIOD_MS);
  return new Date(anchor.getTime() + periods * PERIOD_MS);
}
```

If `subscription-service.ts` already exports a helper for this, **reuse it directly** instead of duplicating. The Phase 4 spec called this out as a JS-only computation; this task must not re-invent it.

### 3. Add the query

```ts
export async function getScheduledViewForUser(
  userId: string,
): Promise<ScheduledView> {
  const snapshot = await subscriptionService.checkSubscription(userId);
  const anchor = snapshot.periodStartDate ?? new Date();
  const now = new Date();
  const periodStartDate = computeCurrentPeriodStart(anchor, now);
  const periodEndsAt = new Date(
    periodStartDate.getTime() + 30 * 24 * 60 * 60 * 1000,
  );

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
        inArray(weeklyBatches.status, ["scheduling", "completed"]),
        gte(weeklyBatches.createdAt, periodStartDate),
      ),
    )
    .orderBy(asc(weeklyBatches.createdAt));

  const schedulingIds = rows
    .filter((r) => r.status === "scheduling")
    .map((r) => r.id);

  const countsByBatch = await loadSelectionCounts(schedulingIds);

  const current: BatchBoxData[] = rows
    .filter((r) => r.status === "scheduling")
    .map((r) => ({
      id: r.id,
      ordinal: r.ordinal,
      theme: r.theme,
      importantThing: r.importantThing,
      totalPosts: r.totalPosts,
      counts: countsByBatch.get(r.id) ?? { facebook: 0, instagram: 0, linkedin: 0 },
      derivedState: "upcoming" as const,  // Stage-1
      alreadyPostedCount: 0,              // Stage-1
      queuedCount: r.totalPosts,          // Stage-1
    }));

  const past: PastBatchRow[] = rows
    .filter((r) => r.status === "completed")
    .map((r) => ({
      id: r.id,
      ordinal: r.ordinal,
      theme: r.theme,
      totalPosts: r.totalPosts,
      // Stage-1: no `completedAt` column on the schema — use createdAt as a
      // proxy. Phase 7 will populate a real `completedAt` (or read from the
      // last scheduled_posts.postedAt) and this mapping changes.
      completedAt: r.createdAt,
    }));

  return { current, past, periodStartDate, periodEndsAt };
}
```

Extract `loadSelectionCounts(batchIds)` as a private helper — it's the same shape as task-01's selection-count query. **Important**: if task-01 lands first, the helper may already exist; reuse, don't duplicate.

### 4. Verify `subscription-service.ts` snapshot

Check that `SubscriptionStateSnapshot` includes `periodStartDate: Date` for all plans (not just Pro). Phase 4 task-06 added it to the Pro branch; this task may need to extend it to Trial/Starter for the windowing helper above.

If the snapshot does not carry it for non-Pro plans, add it (read the existing column, no schema change). Reuse `getProQuotaState()`'s anchor logic — `periodStartDate` is already a column on `subscriptions` for every plan (defaults to row-creation time).

### 5. Drizzle imports

`asc`, `gte`, `and`, `eq`, `inArray` — all already used in `post-service.ts`.

## Acceptance Criteria

- [ ] `postService.getScheduledViewForUser(userId)` exists and is typed.
- [ ] Returns `{current: [], past: [], periodStartDate, periodEndsAt}` for a user with no batches.
- [ ] `current` contains only `status='scheduling'` batches in the current 30-day window.
- [ ] `past` contains only `status='completed'` batches in the current 30-day window.
- [ ] Both sorted by `createdAt ASC` (so Pro ordinals read 1 → 4 top-to-bottom).
- [ ] Every `current` row has `derivedState: "upcoming"`, `alreadyPostedCount: 0`, `queuedCount === totalPosts` in Stage-1.
- [ ] `periodEndsAt - periodStartDate === 30 days` (in ms).
- [ ] Cancelled batches do NOT appear (D-S9).
- [ ] No N+1: one query for batches, one for selection counts.
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Dormant contract (Phase 4 / 7)

When Phase 4 lands `scheduleService.create()`:
- `scheduled_posts` rows start appearing for `scheduling` batches.
- Extend this function to compute `alreadyPostedCount = COUNT(scheduled_posts.status='posted')` per batch.
- Set `derivedState = "currently_posting"` when `alreadyPostedCount > 0 AND queuedCount > 0`.
- `queuedCount = totalPosts - alreadyPostedCount`.
- No changes to the return type or component consumers — just data wiring.

## Notes

- The window is the user's *current* rolling 30-day period, not "the last 30 days." Anchor = `subscriptions.periodStartDate`; advances every 30 days from there (computed in JS, not persisted on read — D-A11).
- Stage-1 will always return `past: []` in production because no posting service exists to mark batches `completed`. The page UI handles the empty case (task-11). Don't return mock data.
- If `subscriptionService.checkSubscription` is expensive (it's called from the `(onboarded)` layout already), consider passing the snapshot as a parameter instead of re-fetching. Look at how Phase 4 wired the snapshot through; mirror that.

## Out of scope

- Reading `scheduled_posts`. Stage-1 is `weeklyBatches.status` only.
- Cancelled-batch display. Cancelled lives on Create Posts (task-01), not here.
- Time-of-day posting schedule (Phase 4).
- Per-post status (Phase 4 / 7).
