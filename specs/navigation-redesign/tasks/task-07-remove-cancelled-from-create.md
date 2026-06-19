# Task 07: Stop surfacing cancelled batches on /create

## Status

pending

## Wave

2

## Description

Today the Create hub at `/create` surfaces cancelled batches inside its `UnscheduledBatchList` cards (per the exploration report). After task-06, cancelled batches have a real home on `/cancelled-posts`. This task removes them from `/create` so they only appear in one place. `/create`'s in-flight cards were already stripped in Wave 1 (task-02), so what's left to remove here is whatever surfaces cancelled-status batches on `/create` (either the same component re-used or a separate cancelled section).

## Dependencies

**Depends on:** task-02 (in-flight cards already gone from `/create`), task-03 (Cancelled Posts shell), task-06 (Cancelled Posts section 1 populated)
**Blocks:** task-08 (Wave 3 strips `/create` further; better to do that against a clean baseline)

**Context from dependencies:** task-02 removed the `UnscheduledBatchList` render from `/create/page.tsx` — but that component may render cancelled batches as a separate group inside its own logic. If task-02's removal already eliminated cancelled-batch rendering from `/create`, this task may be a verification + cleanup only.

## Files to Create

None.

## Files to Modify

- `src/app/(app)/(onboarded)/create/page.tsx` — verify no cancelled-batch rendering remains; remove any leftover JSX/imports related to cancelled batches.
- Whichever query in `create/page.tsx` fetches batches — change the filter to exclude `status === "cancelled"` (if the query returned mixed in-flight + cancelled, and task-02 only stripped the JSX).
- If a dedicated cancelled-cards renderer was used (separate from `UnscheduledBatchList`), remove its file usage.

## Technical Details

### Implementation Steps

1. **Verify Wave 1 state.** Read `src/app/(app)/(onboarded)/create/page.tsx` after Wave 1. Confirm whether cancelled batches still render after task-02's strip.
   - If cancelled batches no longer render here: this task is verification + a cleanup pass to ensure no dead code remains (unused queries, unused imports).
   - If cancelled batches still render here (e.g., task-02 only removed in-flight cards and left a separate cancelled section): proceed to step 2.
2. **Strip the cancelled rendering.** Remove the JSX block that renders cancelled batches and any imports that are now unused.
3. **Tighten the data query.** If `/create` calls `postService.getUnscheduledBatchesForUser` (which may return both reviewing + cancelled), either:
   - Pass a status filter argument (if the helper accepts one), or
   - Remove the call entirely from `/create/page.tsx` if nothing on the page needs unscheduled-batch data anymore. (Wave 3 task-09 will strip the page much further; if `/create` still needs *some* data on it during Wave 2, keep the call but filter to what's actually used.)
4. **Sanity check coverage.** Grep `src/app/(app)/(onboarded)/create/` for `cancelled` (case-insensitive). Expected: zero hits in JSX, possibly hits in comments or filenames you didn't touch — clean those if trivial.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
6. Dev-server smoke test:
   - Cancel a batch from the schedule flow.
   - Navigate to `/create`: cancelled batch is NOT present.
   - Navigate to `/cancelled-posts`: cancelled batch IS present (task-06 already wired this).

### Notes on what NOT to change

- Do not strip the entire `/create` page here — task-09 (Wave 3) does the full rebuild. This task's scope is "cancelled batches gone from /create".
- Do not delete `UnscheduledBatchList` component file even if no longer referenced from `/create` — Wave 3 task-09 cleans up after the full rebuild. If task-09 has already shipped earlier in the same PR somehow, then yes, delete the file. Otherwise leave it.
- Do not modify any data fetched for `/cancelled-posts` — that's task-06's domain.

## Acceptance Criteria

- [ ] `/create` page renders without any cancelled batches visible.
- [ ] Any data fetch on `/create` that used to return cancelled batches is either removed or filtered to exclude cancelled status.
- [ ] No imports left unused in `create/page.tsx`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
- [ ] Dev-server: cancelling a batch shows it on `/cancelled-posts` and not on `/create`.

## Notes

- This task may be very small (a few lines or even zero changes if task-02 fully cleaned up). That's expected and fine — its existence as a discrete task gives the verification a clear owner.
