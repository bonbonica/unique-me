# Task 01: postService.getUnscheduledBatchesForUser

## Status
not started

## Wave
1

## Description

Add a new service-layer function that returns the user's unscheduled batches — `status IN ('reviewing', 'cancelled')` — with per-network counts joined from `post_selections`. Consumed by the Create Posts hub (task-06) to render stacked batch cards.

This is a pure read function. No writes, no `canGenerate` interaction, no side effects.

## Dependencies

**Depends on:** none.
**Blocks:** task-06 (UnscheduledBatchList consumes the return shape), task-07 (page-level data fetch).
**Parallel with:** task-02 (same file; split file regions — task-01 writes near other batch readers, task-02 at the bottom).

## Files to Modify

- `src/lib/services/post-service.ts` (modified) — add the export.

## Implementation Steps

### 1. Add the return type

Near the existing public types at the top of `post-service.ts`:

```ts
export type UnscheduledBatchCard = {
  id: string;
  theme: string;
  importantThing: string;
  totalPosts: number;
  status: "reviewing" | "cancelled";
  counts: { facebook: number; instagram: number; linkedin: number };
};
```

### 2. Add the query

```ts
export async function getUnscheduledBatchesForUser(
  userId: string,
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
        inArray(weeklyBatches.status, ["reviewing", "cancelled"]),
      ),
    )
    .orderBy(desc(weeklyBatches.createdAt));

  if (rows.length === 0) return [];

  const batchIds = rows.map((r) => r.id);

  // One round-trip for all selection rows; group by batchId + platform.
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

  const countsByBatch = new Map<
    string,
    { facebook: number; instagram: number; linkedin: number }
  >();
  for (const id of batchIds) {
    countsByBatch.set(id, { facebook: 0, instagram: 0, linkedin: 0 });
  }
  for (const row of selectionRows) {
    if (!row.batchId) continue;
    const bucket = countsByBatch.get(row.batchId);
    if (!bucket) continue;
    if (row.platform === "facebook") bucket.facebook = row.count;
    else if (row.platform === "instagram") bucket.instagram = row.count;
    else if (row.platform === "linkedin") bucket.linkedin = row.count;
  }

  return rows.map((r) => ({
    id: r.id,
    theme: r.theme,
    importantThing: r.importantThing,
    totalPosts: r.totalPosts,
    status: r.status as "reviewing" | "cancelled",
    counts: countsByBatch.get(r.id) ?? { facebook: 0, instagram: 0, linkedin: 0 },
  }));
}
```

### 3. Export through the barrel

If `src/lib/services/index.ts` re-exports `postService` as a namespace, add `getUnscheduledBatchesForUser` to its surface. If service functions are imported individually, this step is a no-op — TypeScript surfaces the new export automatically.

### 4. Drizzle imports

Confirm `inArray` and `desc` are already imported from `drizzle-orm` (other functions in this file already use them — reuse). The `sql<number>` count helper is the existing project pattern.

## Acceptance Criteria

- [ ] `postService.getUnscheduledBatchesForUser(userId)` exists and is typed.
- [ ] Returns `[]` for a user with no `reviewing` / `cancelled` batches.
- [ ] Returns rows sorted by `createdAt DESC`.
- [ ] Each row has all three platform counts (`0` when no selection rows for that platform).
- [ ] Counts match what `<NetworkWizard />` displays for the same batch (i.e., counts derive from `post_selections`, not `post_variations`).
- [ ] Status field is narrowed to the `"reviewing" | "cancelled"` literal union.
- [ ] No N+1: one query for batches, one query for all selection counts.
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- The status filter intentionally excludes `scheduling`, `scheduled`, `completed`, `in_progress`. `scheduling` lives on the Scheduled page (task-02). `in_progress` is defensively never visited via card UI (the existing `/posts` page redirects it to `/create`).
- Network counts include posts where the user toggled a selection ON for that platform. This is the same definition `<NetworkWizard />` uses — keeping it consistent prevents the card from showing "FB 7" while the wizard shows "FB 5".
- `posts.batchId` is the join key. `post_selections.postId` → `posts.id` → `posts.batchId`. No direct `post_selections.batchId` field exists today.

## Out of scope

- Caching / memoization. Page is server-rendered; one DB call per render is fine at our scale (≤ 4 unscheduled batches per user).
- Pagination. Cap is 4 unscheduled batches (Pro maximum); no paging needed.
- Variations counts. The card surfaces post selections, not variations.
