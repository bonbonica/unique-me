# Task 04: postService Mutations — update, regenerate, selectForNetwork, deselectForNetwork

## Status
not started

## Wave
3

## Description

Add four mutation methods to `postService`: `update` (edit canonical text + hashtags), `regenerate` (with the universal 1× cap from D11), `selectForNetwork`, `deselectForNetwork`. All four enforce ownership and batch-status guards.

## Dependencies

**Depends on:** task-01 (schema), task-02 (post-generator for `regenerate`)
**Blocks:** task-09 (wizard step calls all four), task-12 (dialogs)
**Context from dependencies:** Schema has new columns/tables. `post-generator.ts` exports `regenerateOne(args)`.

## Files to Modify

- `src/lib/services/post-service.ts` — extend (task-03 added `generateWeekly` + `hasAnyBatch`)

## Implementation Steps

### 1. `postService.update(postId, sessionUserId, updates)`

```ts
type UpdateResult =
  | { ok: true; post: Post }
  | { ok: false; error: "not_found" | "not_owned" | "batch_locked" | "db_failed" };

async update(
  postId: string,
  sessionUserId: string,
  updates: { postText?: string; hashtags?: string[] }
): Promise<UpdateResult> {
  // 1. Load post + its batch
  const [post] = await db
    .select({ post: posts, batchStatus: weeklyBatches.status })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!post) return { ok: false, error: "not_found" };
  if (post.post.userId !== sessionUserId) return { ok: false, error: "not_owned" };
  if (post.batchStatus !== "reviewing") return { ok: false, error: "batch_locked" };

  // 2. Update
  try {
    const [updated] = await db
      .update(posts)
      .set({
        ...(updates.postText !== undefined ? { postText: updates.postText } : {}),
        ...(updates.hashtags !== undefined ? { hashtags: updates.hashtags } : {}),
        status: "edited",
      })
      .where(eq(posts.id, postId))
      .returning();

    return { ok: true, post: updated! };
  } catch (err) {
    console.error("[postService.update]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

**Important:** `update` does NOT touch `regenerationCount`. Only `regenerate` increments it.

### 2. `postService.regenerate(postId, sessionUserId, feedback)`

```ts
type RegenerateResult =
  | { ok: true; post: Post; variationsReplaced: number }
  | { ok: false;
      error:
        | "not_found"
        | "not_owned"
        | "regeneration_limit_reached"
        | "batch_locked"
        | "ai_failed"
        | "db_failed" };

async regenerate(
  postId: string,
  sessionUserId: string,
  feedback: string
): Promise<RegenerateResult> {
  // 1. Load post + batch
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
  if (row.post.userId !== sessionUserId) return { ok: false, error: "not_owned" };
  if (row.batchStatus !== "reviewing") return { ok: false, error: "batch_locked" };

  // 2. Hard cap (D11) — UNIVERSAL
  if (row.post.regenerationCount >= 1) {
    return { ok: false, error: "regeneration_limit_reached" };
  }

  // 3. AI call
  const profile = await profileService.get(sessionUserId);
  if (!profile) return { ok: false, error: "not_owned" }; // defensive

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

  // 4. Persist in transaction: update post + replace variations
  try {
    const updated = await db.transaction(async (tx) => {
      await tx.delete(postVariations).where(eq(postVariations.postId, postId));

      const variationRows: NewPostVariation[] = [];
      if (result.variations.instagram) {
        variationRows.push({
          id: crypto.randomUUID(), postId, userId: sessionUserId,
          platform: "instagram",
          postText: result.variations.instagram.postText,
          hashtags: result.variations.instagram.hashtags,
        });
      }
      if (result.variations.linkedin) {
        variationRows.push({
          id: crypto.randomUUID(), postId, userId: sessionUserId,
          platform: "linkedin",
          postText: result.variations.linkedin.postText,
          hashtags: result.variations.linkedin.hashtags,
        });
      }
      if (variationRows.length > 0) {
        await tx.insert(postVariations).values(variationRows);
      }

      const [updatedPost] = await tx
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

      return { post: updatedPost!, variationsReplaced: variationRows.length };
    });

    return { ok: true, post: updated.post, variationsReplaced: updated.variationsReplaced };
  } catch (err) {
    console.error("[postService.regenerate]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

### 3. `postService.selectForNetwork(postId, sessionUserId, platform)`

```ts
type SelectionResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "batch_locked" | "db_failed" };

async selectForNetwork(
  postId: string,
  sessionUserId: string,
  platform: SelectionPlatform
): Promise<SelectionResult> {
  const [row] = await db
    .select({ userId: posts.userId, batchStatus: weeklyBatches.status })
    .from(posts)
    .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
    .where(eq(posts.id, postId))
    .limit(1);

  if (!row) return { ok: false, error: "not_found" };
  if (row.userId !== sessionUserId) return { ok: false, error: "not_owned" };
  if (row.batchStatus !== "reviewing") return { ok: false, error: "batch_locked" };

  try {
    await db
      .insert(postSelections)
      .values({
        id: crypto.randomUUID(),
        postId,
        userId: sessionUserId,
        platform,
      })
      .onConflictDoNothing({ target: [postSelections.postId, postSelections.platform] });

    return { ok: true };
  } catch (err) {
    console.error("[postService.selectForNetwork]", err);
    return { ok: false, error: "db_failed" };
  }
}
```

### 4. `postService.deselectForNetwork(postId, sessionUserId, platform)`

Same ownership/lock guards as above. Then:

```ts
await db
  .delete(postSelections)
  .where(and(eq(postSelections.postId, postId), eq(postSelections.platform, platform)));
```

Same `SelectionResult` shape.

## Acceptance Criteria

- [ ] All four methods exported on `postService`
- [ ] Every method checks: existence → ownership → batch status (in that order)
- [ ] `regenerate` enforces `regenerationCount >= 1` check before any AI call (saves tokens on rejection)
- [ ] `regenerate` increments `regenerationCount` only on success and within the same transaction as the variation replacement
- [ ] `update` does NOT touch `regenerationCount`
- [ ] Both `selectForNetwork` and `deselectForNetwork` are idempotent
- [ ] `npm run lint` and `npm run typecheck` clean
- [ ] Ownership tests: simulating a different `sessionUserId` always returns `not_owned`

## Notes

- The N+1-style inner join on `weeklyBatches` is necessary for the batch-status guard. Single query, fine.
- Don't add `posts.status = "edited"` to selections — selection is separate from post-content state.
- The `regenerate` AI call happens OUTSIDE the transaction (long-running). Transaction only wraps the DB writes. If the AI succeeds but the transaction fails, the regen is lost — acceptable since `regenerationCount` hasn't been bumped (the increment is inside the txn).
