# Task 10: postService.generateWeekly — Accept postCount + Ordinal

## Status
not started

## Wave
3

## Description

Extend `postService.generateWeekly` to:
- Accept `postCount: 7 | 9` and `batchOrdinalInPeriod: number | null` in the input object.
- Persist `totalPosts = postCount` and `batchOrdinalInPeriod` on the new `weekly_batches` row.
- Forward `postCount` to `postGenerator.generate`.
- Return the actual count instead of hardcoded `7`.

The ordinal + count are computed by the caller (task 12, `/create` server). This task is purely the persistence + pass-through.

## Dependencies

**Depends on:** task-01 (`batch_ordinal_in_period` column exists), task-09 (`generate` accepts `postCount`)
**Blocks:** task-12 (`/create` calls this with the computed `postCount`)
**Context from dependencies:** task-01 adds the column; task-09 makes the generator length-aware.

## Files to Modify

- `src/lib/services/post-service.ts` (modified)

## Implementation Steps

### 1. Extend the input shape

```ts
export async function generateWeekly(
  userId: string,
  input: {
    theme: string;
    importantThing: string;
    postLength: PostLength;
    postCount: 7 | 9;
    batchOrdinalInPeriod: number | null;
  },
): Promise<GenerateWeeklyResult>
```

`postCount` and `batchOrdinalInPeriod` are required. Trial / Starter callers will pass `postCount: 7, batchOrdinalInPeriod: null`. Pro callers pass the derived values.

### 2. Persist on the batch row

Inside the insert (around the existing `totalPosts: 7` literal):

```ts
totalPosts: input.postCount,
batchOrdinalInPeriod: input.batchOrdinalInPeriod,
postLength: input.postLength,  // existing
```

### 3. Forward to the generator

Inside the existing call to `postGenerator.generate`, add the `postCount` field:

```ts
const generated = await generate({
  profile,
  theme: input.theme,
  importantThing: input.importantThing,
  postLength: input.postLength,
  postCount: input.postCount,
});
```

### 4. Update the return value

```ts
return { ok: true, batch, postsCreated: input.postCount };
```

(Or whatever shape the existing return uses — match the field names already there.)

### 5. Internal loops over generated posts

The function loops over the generator's output to insert `posts` rows. Confirm the loop iterates `generated.posts.length` (not literal 7). If it currently iterates `7`, switch to `input.postCount` or `generated.posts.length`. Either is correct; prefer the input parameter for symmetry.

### 6. Backward-compatibility note

Existing callers (today: only the `/create` server action) will type-error until task 12 lands. That's expected — Wave 3 tasks 10/11/12 are interdependent. The wave is internally sequential; the build will not pass until 12 is also done. Don't merge 10 alone to main; merge the wave together.

## Acceptance Criteria

- [ ] `generateWeekly` requires `postCount: 7 | 9` and `batchOrdinalInPeriod: number | null`.
- [ ] `totalPosts` column is written from `input.postCount`, not the literal 7.
- [ ] `batchOrdinalInPeriod` column is written.
- [ ] `postCount` is forwarded to the generator.
- [ ] Internal loops use the parameter / generator output, not literal 7.
- [ ] After tasks 10 + 11 + 12 land: `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.
- [ ] Spot-check via Drizzle Studio: a generated Pro batch 4 row shows `total_posts: 9`, `batch_ordinal_in_period: 4`.

## Notes

- The wave is internally coupled: 10 + 11 + 12 should be drafted together (10 and 11 can run in parallel after 09, then 12 lands last). If you're working solo, sequence them 09 → 10 → 11 → 12 and verify build at the end of 12.
- The transaction boundary stays where Phase 2 put it. Adding two more fields to one INSERT does not change the transaction model.
- `batchOrdinalInPeriod = null` for Starter and Trial batches is intentional. Searching for "Pro batches" later is `WHERE batch_ordinal_in_period IS NOT NULL`.
- Do not infer `postCount` from `batchOrdinalInPeriod` inside `generateWeekly`. Trust the caller (task 12) — keeps each function single-responsibility.
