# Task 06: postService.generateWeekly — Accept + Persist postLength

## Status
not started

## Wave
2

## Description

Thread `postLength` through `postService.generateWeekly`:
1. Accept it as part of the input object.
2. Persist it on the new `weekly_batches.post_length` column.
3. Pass it through to `postGenerator.generate(...)`.

No other postService methods change.

## Dependencies

**Depends on:** task-01 (`post_length` column must exist), task-05 (generator must accept `postLength`)
**Blocks:** task-08 (`<GenerateForm />` submits `postLength` and the action calls this method)
**Context from dependencies:** task-01 adds the nullable `post_length` column; task-05 makes the AI prompt length-aware.

## Files to Modify

- `src/lib/services/post-service.ts` (modified) — extend `generateWeekly` input + INSERT + AI call site

## Implementation Steps

1. Update the `generateWeekly` signature:

   ```ts
   export async function generateWeekly(
     userId: string,
     input: { theme: string; importantThing: string; postLength: PostLength }
   ): Promise<GenerateWeeklyResult>
   ```

   `postLength` is required from the caller. The form layer (task-08) decides Pro-only visibility and submits the value (defaulting to `"medium"` for non-Pro callers).

2. Inside the `db.transaction`, add `postLength: input.postLength` to the `weeklyBatches.values({ ... })` insert object. Column name in TS is `postLength`; DB column is `post_length`.

3. Pass `postLength: input.postLength` to the `postGenerator.generate({ ... })` call.

4. Update the JSDoc on `generateWeekly` to mention the new field. No change to the result discriminator union — failure modes are unchanged.

5. Import `PostLength` from `@/lib/schema` if not already imported.

## Acceptance Criteria

- [ ] `generateWeekly` requires `postLength` in its input object.
- [ ] After a successful generate, the new `weekly_batches` row has the supplied `post_length` value.
- [ ] The AI call receives the supplied `postLength` (verified by adding a short-lived console.log during QA, then removing).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.
- [ ] No change to `GenerateWeeklyResult` error variants.

## Notes

- `postLength` is required at the function signature even though the column is nullable. Forcing the caller to pass a value (even `"medium"` for non-Pro) means we don't need to think about NULL semantics inside this function — they're a render-site concern only.
- Don't add `postLength` to `regenerate` in this task. Regeneration uses the original length stored on the batch row (read it from `weeklyBatches.postLength` inside `regenerate` and forward to `regenerateOne`). If the spec evolves to allow length-override on regen, that's a follow-up.
- Don't touch `update`, `selectForNetwork`, `deselectForNetwork`, `scheduleMyPick`, `stopBatch`, `reschedule`, or any read methods.
