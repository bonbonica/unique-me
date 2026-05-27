# Task 03: postService.generateWeekly + canGenerate + hasAnyBatch

## Status
not started

## Wave
3

## Description

Replace the `postService` stub with the real `generateWeekly` implementation. Add `subscriptionService.canGenerate(userId)` as the permanent gate site (Phase 2 implementation: only the trial-1-batch check). Add `postService.hasAnyBatch(userId)` as a thin existence query.

## Dependencies

**Depends on:** task-01 (schema), task-02 (post-generator)
**Blocks:** task-07 (/create page calls these)
**Context from dependencies:** Schema has `post_variations`, `post_selections`, `posts.feedback`, `posts.regeneration_count`, `BatchStatus | "cancelled"`. `post-generator.ts` exports `generate(args): Promise<Generated | null>`.

## Files to Modify / Create

- `src/lib/services/post-service.ts` — REPLACE stub with real impl (this task adds `generateWeekly` + `hasAnyBatch`; task-04 + task-05 add the rest)
- `src/lib/services/subscription-service.ts` — ADD `canGenerate(userId)` method

## Implementation Steps

### 1. Add `subscriptionService.canGenerate(userId)`

Inside the existing `subscriptionService` object (already exports `checkSubscription`):

```ts
async canGenerate(userId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: "trial_batch_exists" /* | future Phase 3 reasons */ }
> {
  const subscription = await this.checkSubscription(userId);

  if (subscription.status === "trial") {
    const exists = await postService.hasAnyBatch(userId);
    if (exists) {
      return { allowed: false, reason: "trial_batch_exists" };
    }
  }

  // TODO(phase-3-gating): Starter weekly cycle, PAYG balance, Pro monthly limits, etc.
  return { allowed: true };
}
```

Avoid the circular-import: import `postService` lazily inside the function, OR move `hasAnyBatch` to a free function in `src/lib/services/batch-queries.ts` that both services call.

### 2. Add `postService.hasAnyBatch(userId)`

```ts
async hasAnyBatch(userId: string): Promise<boolean> {
  const result = await db
    .select({ id: weeklyBatches.id })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.userId, userId))
    .limit(1);
  return result.length > 0;
}
```

### 3. Implement `postService.generateWeekly`

```ts
type GenerateWeeklyResult =
  | { ok: true; batchId: string; postsCreated: number; variationsCreated: number }
  | { ok: false;
      error: "no_profile" | "trial_batch_exists" | "ai_failed" | "db_failed";
      details?: string };

async generateWeekly(
  userId: string,
  input: { theme: string; importantThing: string }
): Promise<GenerateWeeklyResult> {
  // 1. Profile check
  const profile = await profileService.get(userId);
  if (!profile) return { ok: false, error: "no_profile" };

  // 2. Gate check (D20 + future Phase 3)
  const gate = await subscriptionService.canGenerate(userId);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason };
  }

  // 3. AI call
  const generated = await postGenerator.generate({
    profile,
    theme: input.theme,
    importantThing: input.importantThing,
  });
  if (!generated) return { ok: false, error: "ai_failed" };

  // 4. Persist in one transaction
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

      // Variation rows (per post per platform if present in AI output)
      const variationRows: NewPostVariation[] = [];
      for (let i = 0; i < generated.posts.length; i++) {
        const aiPost = generated.posts[i]!;
        const dbPostId = postRows[i]!.id;
        // TODO(phase-3-gating): skip these inserts when subscription plan === 'starter'.
        // Phase 2 treats every user as Pro for variation generation.
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
```

### 4. TODO markers

Every credit/plan gate site uses the literal marker `TODO(phase-3-gating)` (grep-able). Two locations in this task:
- Inside `canGenerate` after the trial branch.
- Inside `generateWeekly` at the variation-insert site.

## Acceptance Criteria

- [ ] `subscriptionService.canGenerate(userId)` exported with the signature above
- [ ] `postService.hasAnyBatch(userId)` exported
- [ ] `postService.generateWeekly(userId, input)` exported with `GenerateWeeklyResult`
- [ ] Trial users with an existing batch (any status) get `{ ok: false, error: "trial_batch_exists" }`
- [ ] Trial users with NO batch can generate exactly once
- [ ] DB transaction rolls back on any insert failure (verified by simulating)
- [ ] Two `TODO(phase-3-gating)` markers exist (grep returns 2)
- [ ] `npm run lint` and `npm run typecheck` clean

## Notes

- `crypto.randomUUID()` is fine for Node 20+ which the project already requires.
- All inserts must include `userId` even on rows that already FK to `posts` (which already FKs to `user`) — needed for row-level isolation queries that scan by `userId` directly.
- Don't preflight-check the model output count — `generatedSchema.length(7)` already enforces it at the Zod boundary.
