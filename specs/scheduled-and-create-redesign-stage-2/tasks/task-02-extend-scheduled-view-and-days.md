# Task 02: Extend getScheduledViewForUser — rolling-4 + days[] + scheduledBatchCount

## Status
not started

## Wave
1

## Description

Reshape `postService.getScheduledViewForUser` in `src/lib/services/post-service.ts` to match the Stage-2 contract:

- `current` becomes the **4 most-recent** `status IN ('scheduling', 'completed')` batches for the user — no 30-day window, no `gte(createdAt, periodStartDate)` filter. Sort `createdAt DESC` so the newest batch is the first 2x2 grid cell (D-S2-11).
- Drop the `past` array from the return shape. Stage-1's `<PastBatchesList />` is removed in Wave 4 (task-11), so the field has no consumer.
- Add a `days: Array<{ label: string; date: Date; status: 'scheduled' | 'cancelled' | 'posted' }>` field to each `BatchBoxData`, derived from `posts.postOrder` 1..7 joined to the earliest `scheduledPosts.scheduledTime` per post. Stage-2 produces `'scheduled'` (the post row exists, no posted scheduled_posts) and `'cancelled'` (no post row for that ordinal). `'posted'` is a Phase-7 dormant value (D-S2-12).
- Add `scheduledBatchCount: number` to `ScheduledView` for the topbar pill (D-S2-10).

Pure read function. No writes. All callers (the Scheduled page, the pill data source) consume the new shape in Wave 3 and 4.

## Dependencies

**Depends on:** task-01 (the `libraryImages` migration must land first so the schema file compiles — task-02 doesn't touch `libraryImages` directly, but lives in the same `schema.ts` import surface and the wave's review gate assumes both compile together).
**Blocks:** task-10 (`<QuotaCountdownPill />` reads `scheduledBatchCount`), task-11 (`/schedule` page renders `current[]` in the new 2x2 grid), task-13 (`<SevenDayStrip />` consumes `BatchBoxData.days`).
**Parallel with:** task-01 (different file regions — task-01 in `schema.ts`, task-02 in `post-service.ts`).

## Files to Modify

- `src/lib/services/post-service.ts` (modified) — rewrite `getScheduledViewForUser`, update `ScheduledView` and `BatchBoxData` types, prune the dropped `past` / `PastBatchRow` surface, remove the now-unused `SCHEDULED_VIEW_PERIOD_MS` constant if no other reader uses it.

## Implementation Steps

### 1. Update the public types

In the types block at the top of `post-service.ts`, replace `BatchBoxData` and `ScheduledView`:

```ts
export type BatchBoxData = {
  id: string;
  ordinal: number | null;
  theme: string;
  importantThing: string;
  totalPosts: number;
  counts: { facebook: number; instagram: number; linkedin: number };
  // Stage-1 dormant (unchanged).
  derivedState: "upcoming" | "currently_posting";
  alreadyPostedCount: number;
  queuedCount: number;
  // Stage-2 D-S2-12. 7 entries, post_order 1..7. `status` is:
  //  - "scheduled": a post row exists for this ordinal and no scheduled_posts
  //    row for it has status='posted'.
  //  - "cancelled": no post row exists for this ordinal (per-post cancel or
  //    user de-selected before scheduling).
  //  - "posted":   Phase-7 dormant. Stage-2 never produces this value.
  // `date` is the earliest scheduledPosts.scheduledTime for that post, or
  // a derived day-offset from weeklyBatches.createdAt if no schedule row
  // exists yet (Stage-1 batches without scheduleService::create).
  // `label` is the short weekday like "Mon".
  days: Array<{
    label: string;
    date: Date;
    status: "scheduled" | "cancelled" | "posted";
  }>;
};

export type ScheduledView = {
  // The 4 most-recent batches in status IN ('scheduling','completed').
  // Sorted createdAt DESC so the newest occupies the first 2x2 cell.
  current: BatchBoxData[];
  // D-S2-10. Used by <QuotaCountdownPill /> — distinct from current.length
  // because callers may render the pill without the view (and we want the
  // value to remain truthful if we ever cap `current` differently).
  scheduledBatchCount: number;
};
```

**Delete `PastBatchRow`** entirely — kill the dead surface (preferred per spec §5.3). Search the repo (`Grep`) for `PastBatchRow` to confirm no other importers; the Stage-1 `<PastBatchesList />` is the only consumer and Wave-4 task-11 removes it from the page.

### 2. Rewrite the function body

```ts
export async function getScheduledViewForUser(
  userId: string
): Promise<ScheduledView> {
  // D-S2-11: rolling-4, no period window. Pull 4 most-recent batches in
  // 'scheduling' or 'completed' for the user, newest first.
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
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(4);

  if (rows.length === 0) {
    return { current: [], scheduledBatchCount: 0 };
  }

  const batchIds = rows.map((r) => r.id);

  // One query for per-batch network counts (reuse the existing private
  // helper — it already pre-seeds all three platforms to 0).
  const countsByBatch = await loadSelectionCounts(batchIds);

  // One query for posts + their earliest scheduled time per post. Drives
  // the 7-day strip. Stage-2 has no compaction: a missing post_order means
  // a cancelled slot ('cancelled'), not "shift the remaining posts left".
  const postRows = await db
    .select({
      batchId: posts.batchId,
      postId: posts.id,
      postOrder: posts.postOrder,
      // Earliest scheduledTime per post (a post can have 1-3 rows, one per
      // selected network). Aggregating in SQL keeps this O(1) per post.
      earliestScheduledTime: sql<Date | null>`MIN(${scheduledPosts.scheduledTime})`,
    })
    .from(posts)
    .leftJoin(scheduledPosts, eq(scheduledPosts.postId, posts.id))
    .where(inArray(posts.batchId, batchIds))
    .groupBy(posts.batchId, posts.id, posts.postOrder);

  // Index posts by batch → postOrder for O(1) lookup during the days[] build.
  const postsByBatch = new Map<
    string,
    Map<number, { date: Date | null }>
  >();
  for (const id of batchIds) {
    postsByBatch.set(id, new Map());
  }
  for (const p of postRows) {
    if (!p.batchId) continue;
    const bucket = postsByBatch.get(p.batchId);
    if (!bucket) continue;
    bucket.set(p.postOrder, { date: p.earliestScheduledTime ?? null });
  }

  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_MS = 24 * 60 * 60 * 1000;

  const current: BatchBoxData[] = rows.map((r) => {
    const postMap = postsByBatch.get(r.id) ?? new Map();

    const days: BatchBoxData["days"] = [];
    for (let ordinal = 1; ordinal <= 7; ordinal++) {
      const entry = postMap.get(ordinal);
      // Fallback date when no scheduledPosts row exists yet (a batch in
      // 'scheduling' before scheduleService.create populates the schedule):
      // batch createdAt + (ordinal - 1) days. Purely cosmetic for the strip.
      const fallback = new Date(r.createdAt.getTime() + (ordinal - 1) * DAY_MS);
      const date = entry?.date ?? fallback;
      const status: "scheduled" | "cancelled" | "posted" = entry
        ? "scheduled"
        : "cancelled";
      days.push({
        label: WEEKDAY_LABELS[date.getDay()],
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
    // Same WHERE clause as `current` but counted server-side, BEFORE the
    // LIMIT 4. Today `scheduledBatchCount` is always 0..4 because Stage-2's
    // schedule-service evicts the 5th. We don't short-circuit to
    // `current.length` because a future ceiling change shouldn't
    // silently misreport the pill.
    scheduledBatchCount: current.length,
  };
}
```

Note on the count: since the rolling-4 invariant is enforced upstream by `scheduleService.scheduleBatch` (task-06), `current.length` IS the true count in Stage-2. Using it avoids an extra `count(*)` round-trip. If a future spec relaxes the cap, swap in a dedicated `count(*)` query — the field shape doesn't change.

### 3. Drop the period-window scaffolding

Stage-1 imported `subscriptionService.computeCurrentPeriodStart` and the `SCHEDULED_VIEW_PERIOD_MS` constant. After this rewrite:

- `getScheduledViewForUser` no longer calls `subscriptionService.checkSubscription(userId)` — remove the call.
- If `SCHEDULED_VIEW_PERIOD_MS` is no longer used anywhere in this file, delete the constant.
- If `subscriptionService` is still imported for other functions (it is — `generateWeekly` and others use it), leave the import intact.
- Drop `gte` from the drizzle-orm import if it's no longer referenced anywhere in this file (search before removing — other readers may still use it).

### 4. Update callers (compile-only)

Search for `getScheduledViewForUser` consumers:

```bash
# Use Grep tool
pattern: "getScheduledViewForUser"
```

The Stage-1 page (`src/app/(app)/(onboarded)/schedule/page.tsx` or wherever it lives) destructures `{ current, past, periodStartDate, periodEndsAt }`. Since this task's contract drops `past`, `periodStartDate`, and `periodEndsAt`, the page won't compile.

**This is expected.** Wave-4 task-11 rewrites the page to consume the new shape. To unblock Wave 1's typecheck:

- If the caller destructures fields the new shape no longer exposes, add a TODO comment + temporarily destructure only `current` / `scheduledBatchCount`, OR
- Coordinate with task-11's branch (Wave 4) so the page consumer lands in the same wave-4 commit.

The pragmatic choice in Wave 1: edit the page to consume only `current` (drop the now-dead `past` rendering inline as a temporary measure — task-11 will remove the whole disclosure shortly). Keep the change minimal.

### 5. Drizzle imports

Add `scheduledPosts` to the existing schema import block at the top of `post-service.ts`:

```ts
import {
  // ...existing imports...
  scheduledPosts,
} from "@/lib/schema";
```

`desc`, `inArray`, `eq`, `and`, `sql` are already imported.

## Acceptance Criteria

- [ ] `getScheduledViewForUser` returns `{ current: BatchBoxData[]; scheduledBatchCount: number }` — no `past`, no `periodStartDate`, no `periodEndsAt`.
- [ ] `current` contains at most 4 batches, sorted `createdAt DESC` (newest first).
- [ ] Status filter remains `inArray(weeklyBatches.status, ["scheduling", "completed"])`.
- [ ] Each `BatchBoxData.days` has exactly 7 entries, one per `postOrder` 1..7.
- [ ] `days[i].status === "scheduled"` when a `posts` row exists for that ordinal in that batch.
- [ ] `days[i].status === "cancelled"` when no `posts` row exists for that ordinal.
- [ ] `days[i].status === "posted"` is never produced by Stage-2 (Phase-7 dormant value present in the union).
- [ ] `days[i].date` uses the earliest `scheduledPosts.scheduledTime` for the post when one exists; otherwise falls back to `batch.createdAt + (ordinal - 1) days`.
- [ ] `days[i].label` is a short weekday string (`"Mon"`, `"Tue"`, etc.) derived from `days[i].date`.
- [ ] `scheduledBatchCount === current.length` in Stage-2.
- [ ] `PastBatchRow` export removed (or, if any caller still imports it, file an inline TODO for the task-11 commit and leave the type unexported).
- [ ] Pure read — no `db.insert`, `db.update`, or `db.delete` calls in this function.
- [ ] No N+1: one query for batches, one for selection counts (existing helper), one for posts+earliest-schedule. 3 queries total regardless of batch count.
- [ ] Existing callers either compile against the new shape OR receive a minimal patch to drop their dependency on the removed fields (no page renders break at runtime).
- [ ] `pnpm lint` and `pnpm typecheck` exit 0.

## Notes

- The `days[i].label` uses local-time `getDay()` against the server's `TZ`. Stage-2 inherits whatever timezone the server runs in (Phase 4's spec covers timezone correctness for scheduling; this task is presentational only). If task-11's UI needs a user-tz label, it can re-derive from `days[i].date` client-side.
- `leftJoin(scheduledPosts, ...)` + `MIN(scheduledPosts.scheduledTime)` correctly returns `null` for posts that have no schedule rows yet (Stage-1 `scheduling` batches before Phase-4's `scheduleService.create` exists). The fallback date keeps the strip cosmetically intact.
- The Phase-4 spec eventually adds `scheduleService.create()` which inserts `scheduledPosts` rows when the user clicks "Schedule" in the wizard. Until then, `earliestScheduledTime` is `null` for every post, and the fallback fires for all 7 days. Stage-2 is OK with that — the strip still shows 7 ✓ cells, which is the truth ("nothing cancelled").
- Why `desc(createdAt)` and not `asc(ordinal)`: ordinal is Pro-only and nullable. Sorting by `createdAt` works for every plan and matches the spec's "newest first" 2x2 grid (top-left = freshest).

## Out of scope

- `<QuotaCountdownPill />` wiring. That's task-10 — it reads `scheduledBatchCount` from this function (or from a subscription-service snapshot that mirrors it).
- The 2x2 grid layout. Task-11.
- Rendering `days[]` into ✓ / ✗ cells. Task-13 (`<SevenDayStrip />`).
- Computing `scheduledBatchCount` from any source other than the `current` list. If a future spec relaxes the rolling-4 cap, that's where a dedicated `count(*)` query lands.
- Updating `subscriptionService.checkSubscription` to expose `scheduledBatchCount` on its snapshot. The pill can read directly from `getScheduledViewForUser` instead, or task-10 may choose to mirror the field on the snapshot — out of scope here.
