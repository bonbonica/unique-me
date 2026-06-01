# Task 11: postService.regenerate — Length-Aware (Closes Phase 3 Follow-up)

## Status
not started

## Wave
3

## Description

Make `postService.regenerate` batch-length-aware. Read `batch.totalPosts` from the existing row, pass it into `regenerateOne` as `postCount`. Closes the Phase 3 task-06 deferred follow-up (D-A17).

Without this change, regenerating a single post inside a 9-post Pro batch invokes a generator constrained to 7-post output — schema mismatch, AI confusion, broken UX.

## Dependencies

**Depends on:** task-09 (`regenerateOne` accepts `postCount`)
**Blocks:** task-19 (audit verifies regenerate works on 9-post batches)
**Context from dependencies:** task-09 makes `regenerateOne` require `postCount: 7 | 9`. Currently `postService.regenerate` does not pass this — task is the fix.

Can run in parallel with task 10 (both edit `post-service.ts` but different functions). If lock contention is a concern, sequence 10 → 11.

## Files to Modify

- `src/lib/services/post-service.ts` (modified)

## Implementation Steps

### 1. Locate `regenerate` in `post-service.ts`

The function fetches the batch and calls `regenerateOne` with the existing parameters (profile, theme, importantThing, currentPostText, etc.). It does NOT currently read `postLength` or `postCount` from the batch row — that's the gap.

### 2. Read `postLength` and `totalPosts` from the batch row

Inside the function, wherever the batch is fetched (existing query), confirm both columns are in the SELECT — `postLength` and `totalPosts`. If the existing query uses `columns: { ... }` to narrow the projection, add both fields.

If the existing query uses `db.query.weeklyBatches.findFirst` with no `columns` filter, the full row is returned and no change is needed.

### 3. Validate and pass to `regenerateOne`

```ts
// totalPosts has a NOT NULL default 7, so it is always 7 or 9 in practice.
// Narrow to the union with a runtime check so a malformed row fails loudly
// rather than producing a garbage result.
const postCount: 7 | 9 =
  batch.totalPosts === 9 ? 9 : 7;

const result = await regenerateOne({
  // ...existing fields...
  postLength: (batch.postLength as PostLength | null) ?? "medium",
  postCount,
});
```

The `postLength` cast + nullish coalescence matches Phase 3's "treat NULL as medium" rule.

### 4. Do not infer ordinal here

`batchOrdinalInPeriod` is irrelevant for regenerate — we're regenerating one post in an existing batch, not creating a new one. Do NOT add ordinal handling to this function.

## Acceptance Criteria

- [ ] `regenerate` reads `batch.totalPosts` from the batch row.
- [ ] `regenerate` reads `batch.postLength` from the batch row (closing the original Phase 3 follow-up).
- [ ] Both values are passed into `regenerateOne` with correct types.
- [ ] Regenerating a post in a 9-post Pro batch produces a valid output (manual smoke after task 12 lands and a Pro user can be seeded).
- [ ] Regenerating a post in a 7-post Starter / Trial batch is byte-for-byte identical in behavior (regression check).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The Phase 3 task-06 note explicitly deferred `postLength` plumbing for regenerate. This task closes that AND the new `postCount` requirement in one go, since both reads happen at the same place.
- Defensive narrow: `batch.totalPosts === 9 ? 9 : 7` rejects any value outside the union without a runtime error. If a future phase introduces other batch sizes, the type union and this narrow update together.
- Do not add a new error variant to `regenerate`'s return type for length mismatches. The narrow above means we either pass 7 or 9 — never invalid.
- Consider adding a Vitest case for `regenerate` length-awareness in task 08's suite or as a follow-up; the parity-focused suite from task 08 does not currently cover regenerate. Out of scope for this task — file a follow-up if needed.
