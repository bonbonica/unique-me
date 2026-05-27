# Task 05: postService Commit + Read Methods — scheduleMyPick, stopBatch, getBatchForReview, getCurrentBatch

## Status
not started

## Wave
3

## Description

Add the single commit method (`scheduleMyPick`), the cancellation method (`stopBatch`), and the two read methods the UI needs (`getBatchForReview`, `getCurrentBatch`).

## Dependencies

**Depends on:** task-01 (schema)
**Blocks:** task-10 (summary calls `scheduleMyPick`), task-11 (locked summary calls `stopBatch`), task-08 (wizard skeleton calls reads)
**Context from dependencies:** Schema has `post_selections`, `BatchStatus | "cancelled"`.

## Files to Modify

- `src/lib/services/post-service.ts` — extend

## Implementation Steps

### 1. `postService.scheduleMyPick(batchId, sessionUserId)`

```ts
type ScheduleResult =
  | { ok: true; batchId: string; committedSelections: number }
  | { ok: false;
      error: "not_found" | "not_owned" | "batch_already_locked" | "no_selections" | "db_failed" };

async scheduleMyPick(
  batchId: string,
  sessionUserId: string
): Promise<ScheduleResult> {
  // 1. Load batch
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) return { ok: false, error: "not_owned" };
  if (batch.status !== "reviewing") return { ok: false, error: "batch_already_locked" };

  // 2. Count selections
  const [{ count: selectionCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postSelections)
    .innerJoin(posts, eq(posts.id, postSelections.postId))
    .where(eq(posts.batchId, batchId));

  if (!selectionCount || selectionCount === 0) {
    return { ok: false, error: "no_selections" };
  }

  // 3. Race-safe status update
  try {
    const updateResult = await db
      .update(weeklyBatches)
      .set({ status: "scheduling" })
      .where(and(eq(weeklyBatches.id, batchId), eq(weeklyBatches.status, "reviewing")))
      .returning({ id: weeklyBatches.id });

    if (updateResult.length === 0) {
      // Another tab/request won the race
      return { ok: false, error: "batch_already_locked" };
    }

    return { ok: true, batchId, committedSelections: selectionCount };
  } catch (err) {
    console.error("[postService.scheduleMyPick]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

### 2. `postService.stopBatch(batchId, sessionUserId)`

```ts
type StopResult =
  | { ok: true; batchId: string }
  | { ok: false; error: "not_found" | "not_owned" | "not_scheduling" | "db_failed" };

async stopBatch(batchId: string, sessionUserId: string): Promise<StopResult> {
  const [batch] = await db
    .select({ userId: weeklyBatches.userId, status: weeklyBatches.status })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch) return { ok: false, error: "not_found" };
  if (batch.userId !== sessionUserId) return { ok: false, error: "not_owned" };
  if (batch.status !== "scheduling") return { ok: false, error: "not_scheduling" };

  try {
    const updateResult = await db
      .update(weeklyBatches)
      .set({ status: "cancelled" })
      .where(and(eq(weeklyBatches.id, batchId), eq(weeklyBatches.status, "scheduling")))
      .returning({ id: weeklyBatches.id });

    if (updateResult.length === 0) {
      return { ok: false, error: "not_scheduling" }; // raced
    }
    return { ok: true, batchId };
  } catch (err) {
    console.error("[postService.stopBatch]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

### 3. `postService.getBatchForReview(batchId, sessionUserId)`

```ts
type BatchForReview = {
  batch: WeeklyBatch;
  platforms: SelectionPlatform[];                // from profile.platforms
  posts: Array<Post & {
    variations: { instagram?: PostVariation; linkedin?: PostVariation };
    selections: SelectionPlatform[];
  }>;
};

async getBatchForReview(
  batchId: string,
  sessionUserId: string
): Promise<BatchForReview | null> {
  // 1. Batch + ownership
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(eq(weeklyBatches.id, batchId))
    .limit(1);

  if (!batch || batch.userId !== sessionUserId) return null;

  // 2. Profile (for platforms)
  const profile = await profileService.get(sessionUserId);
  if (!profile) return null;
  const platforms = profile.platforms as SelectionPlatform[];

  // 3. Posts
  const postRows = await db
    .select()
    .from(posts)
    .where(eq(posts.batchId, batchId))
    .orderBy(asc(posts.postOrder));

  // 4. Variations (one query, bucket by postId)
  const variationRows = await db
    .select()
    .from(postVariations)
    .where(inArray(postVariations.postId, postRows.map((p) => p.id)));

  // 5. Selections (one query, bucket by postId)
  const selectionRows = await db
    .select()
    .from(postSelections)
    .where(inArray(postSelections.postId, postRows.map((p) => p.id)));

  const variationsByPostId = new Map<string, { instagram?: PostVariation; linkedin?: PostVariation }>();
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
```

Three queries total (posts, variations, selections). Don't do N+1.

### 4. `postService.getCurrentBatch(sessionUserId)`

```ts
async getCurrentBatch(sessionUserId: string): Promise<WeeklyBatch | null> {
  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.userId, sessionUserId),
        inArray(weeklyBatches.status, ["reviewing", "scheduling"])
      )
    )
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return batch ?? null;
}
```

Used by `/posts` when no `batchId` query param is given — typically right after Generate redirects.

## Acceptance Criteria

- [ ] `scheduleMyPick` returns `no_selections` when zero `post_selections` rows exist for the batch
- [ ] `scheduleMyPick` race-safe: the status-guarded UPDATE ensures a losing concurrent call returns `batch_already_locked`
- [ ] `stopBatch` only works when status is exactly `"scheduling"` (not from `reviewing` or `cancelled`)
- [ ] `getBatchForReview` runs at most 4 queries (batch, profile, posts, variations, selections — profile is its own call inside `profileService`)
- [ ] `getBatchForReview` returns `null` when batch missing OR not owned by session user
- [ ] `getCurrentBatch` returns the most recent `reviewing`-or-`scheduling` batch only (never `cancelled` / `completed`)
- [ ] `npm run lint` and `npm run typecheck` clean
- [ ] Ownership tests: foreign-user calls return null / not_owned

## Notes

- The `sql<number>\`count(*)::int\`` cast keeps the return type as a TypeScript `number` rather than a `string`.
- Bucketing variations/selections by `Map<postId, ...>` after the bulk queries avoids the per-post N+1 trap.
