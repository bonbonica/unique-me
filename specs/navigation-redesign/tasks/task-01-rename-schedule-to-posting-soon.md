# Task 01: Rename /schedule → /posting-soon

## Status

pending

## Wave

1

## Description

The current `/schedule` route (and its `/schedule/[batchId]` detail view) shows the user's already-scheduled batches waiting to publish. The redesign relabels this surface to "Posting Soon" — a clearer name for "scheduled posts waiting to go out". This task moves the existing route files from `src/app/(app)/(onboarded)/schedule/` to `src/app/(app)/(onboarded)/posting-soon/` with no functional change to the page contents. Wave 4 (task-10) will add the per-post cancel and bulk cancel UI; this task is purely a folder move so Wave 4 can build on the new path.

## Dependencies

**Depends on:** None (Wave 1)
**Blocks:** task-06 (so the cancelled-posts page knows the new "Posting Soon" path label/link), task-10 (per-post + bulk cancel will live on the new path)

**Context from dependencies:** None. This is a Wave 1 starter task.

## Files to Create

- `src/app/(app)/(onboarded)/posting-soon/page.tsx` — copy of today's `src/app/(app)/(onboarded)/schedule/page.tsx`
- `src/app/(app)/(onboarded)/posting-soon/[batchId]/page.tsx` — copy of today's `src/app/(app)/(onboarded)/schedule/[batchId]/page.tsx`
- Any other files currently in `src/app/(app)/(onboarded)/schedule/` (loading.tsx, error.tsx, layout.tsx if present) — copy with same name

## Files to Modify

- Every file inside the copied folder that imports something using a relative path needs its imports rechecked; relative paths to siblings inside the moved folder stay the same, but imports to outside the folder may need adjusting.
- `src/components/dashboard/sidebar.tsx` — change the `Scheduled` item's href from `/schedule` to `/posting-soon`, and rename the visible label from "Scheduled" to "Posting Soon". (NOTE: task-04 owns the larger sidebar reshape — coordinate by ONLY changing this single entry's href + label in this task; task-04 will do the rest of the reorder/rename and not touch this entry.)

## Files to Delete

- `src/app/(app)/(onboarded)/schedule/page.tsx`
- `src/app/(app)/(onboarded)/schedule/[batchId]/page.tsx`
- Any sibling files inside the original `schedule/` folder
- The empty `src/app/(app)/(onboarded)/schedule/` folder itself

## Technical Details

### Implementation Steps

1. List the contents of `src/app/(app)/(onboarded)/schedule/` to identify every file (page.tsx, [batchId]/page.tsx, and any optional loading.tsx / error.tsx / layout.tsx).
2. Create the new folder `src/app/(app)/(onboarded)/posting-soon/` and copy every file across with identical contents.
3. Inspect every imported module path in the copied files. Paths using `@/` aliases stay correct. Relative paths that traversed up out of the old folder (e.g. `../../../components/...`) are still correct because the new folder is at the same depth. Verify by running `pnpm typecheck` after the move.
4. Update **internal links and navigation** that point at `/schedule` or `/schedule/[batchId]` to point at `/posting-soon` and `/posting-soon/[batchId]` respectively. Find these with: `Grep` for `"/schedule"` (string literal) and `href="/schedule` across the entire `src/` tree. Common locations to expect:
   - `src/components/dashboard/sidebar.tsx` (this task updates the one entry)
   - Anywhere a server action returns a `redirect("/schedule/...")` after a successful schedule operation
   - Deep-link generation inside post-service or schedule-service helpers
5. Delete the original `schedule/` folder and its files.
6. Run `pnpm lint`, `pnpm typecheck`, and `pnpm build` (or `next build`) to confirm nothing broken.
7. Hit `/posting-soon` in the dev server and confirm it renders identically to the old `/schedule`.

### Code Snippets

The sidebar entry for this route is currently at `src/components/dashboard/sidebar.tsx` (around lines 47–57). Today it looks like:

```ts
{ label: "Scheduled", href: "/schedule", icon: Calendar }
```

After this task it should be:

```ts
{ label: "Posting Soon", href: "/posting-soon", icon: Calendar }
```

Leave the entry's position in the array alone — task-04 reorders the array.

### Notes on what NOT to change

- Do not change any logic inside the page files. Render output, server actions called, query parameters — all identical.
- Do not add a `next.config.ts` redirect for `/schedule` → `/posting-soon` here. That belongs to task-05.
- Do not touch the `/posts/currently-posting` route in this task. task-04 handles its deletion.

## Acceptance Criteria

- [ ] `src/app/(app)/(onboarded)/posting-soon/page.tsx` exists and matches the contents of the old `schedule/page.tsx`.
- [ ] `src/app/(app)/(onboarded)/posting-soon/[batchId]/page.tsx` exists and matches the contents of the old `schedule/[batchId]/page.tsx`.
- [ ] The old `src/app/(app)/(onboarded)/schedule/` folder is gone (no `.gitkeep`, no leftover files).
- [ ] Sidebar's calendar entry now reads "Posting Soon" with href `/posting-soon`.
- [ ] No grep hits for `"/schedule"` or `'/schedule'` as a route path remain in `src/` (excluding TypeScript-style commentary or unrelated words like "schedule a meeting" in copy).
- [ ] `pnpm lint`, `pnpm typecheck`, and `pnpm build` all pass.
- [ ] Dev server: navigating to `/posting-soon` renders the same content as today's `/schedule`; navigating to `/posting-soon/[batchId]` renders the same content as today's `/schedule/[batchId]`.

## Notes

If a server action or service helper returns `redirect("/schedule/...")` after a successful schedule operation, update those redirects in this task — internal navigation must use the new path so users don't bounce through the `next.config.ts` redirect for normal in-app flows.
