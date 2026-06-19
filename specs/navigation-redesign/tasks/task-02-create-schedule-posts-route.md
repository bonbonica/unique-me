# Task 02: Create /schedule-posts route + remove in-flight cards from /create

## Status

pending

## Wave

1

## Description

The current Create hub at `/create` does double duty: it has the "Start new batch" form AND surfaces in-flight (reviewing-status) batches as cards. The redesign splits these: Create Posts (`/create`) becomes a single-job "kickoff" page (rebuilt in Wave 3, task-09), and **Schedule Posts** (`/schedule-posts`) becomes the home for in-flight batches that the user is reviewing/editing/regenerating/scheduling.

This task creates the new `/schedule-posts` route with the in-flight batch list (lifted from `/create`) and the per-batch detail view at `/schedule-posts/[batchId]` (which renders today's NetworkWizard — the existing review/edit/regenerate/schedule experience). It also removes the in-flight cards from `/create` so they don't appear in two places. Generation's post-success redirect should now go to `/schedule-posts/[batchId]` so the user lands directly in the per-batch review view (today they land at `/posts?batchId=X` — task-05 handles that redirect; this task fixes the generator's `redirect()` call directly).

## Dependencies

**Depends on:** None (Wave 1)
**Blocks:** task-06 (cancelled batches section needs the in-flight cards to already have moved out of `/create`), task-07 (same), task-10 (Posting Soon cancel UX assumes the new routing landscape exists)

**Context from dependencies:** None. This is a Wave 1 starter task.

## Files to Create

- `src/app/(app)/(onboarded)/schedule-posts/page.tsx` — List view of in-flight (reviewing-status) batches as cards. Empty state when none exist.
- `src/app/(app)/(onboarded)/schedule-posts/[batchId]/page.tsx` — Per-batch review/edit/regen/schedule view. Renders the same `<NetworkWizard>` (and `<LockedSummary>` for `scheduling` status, and `cancelled`-mode wizard for `cancelled` status) that today's `src/app/(app)/(onboarded)/posts/page.tsx` renders. The whole branching logic moves over.

## Files to Modify

- `src/app/(app)/(onboarded)/create/page.tsx` — Remove the UnscheduledBatchList rendering (the cards block). Leave the "Start new batch" form intact for now; Wave 3 (task-09) replaces the whole page.
- `src/app/(app)/(onboarded)/create/actions.ts` — In `generateWeeklyAction` (around line 41), the success-path `redirect()` call currently points at `/posts?batchId=${id}`. Change it to `/schedule-posts/${id}`. Verify with a grep for `/posts` inside `create/actions.ts` to catch any other deep links.
- `src/components/dashboard/sidebar.tsx` — Add a new sidebar entry "Schedule Posts" with href `/schedule-posts` and an appropriate Lucide icon (suggestion: `ClipboardList`). Position is unimportant here; task-04 reorders the whole sidebar.
- Any other server-side `redirect()` calls that currently point at `/posts` (especially `/posts?batchId=...`) anywhere in `src/` — switch them to `/schedule-posts/...`. Internal in-app navigation should never rely on the `next.config.ts` legacy redirect.

## Technical Details

### Implementation Steps

1. **Inventory existing `/posts` and `/create` page logic.** Read these files end-to-end:
   - `src/app/(app)/(onboarded)/posts/page.tsx` (the review+schedule page; lines 30–102 per the exploration report)
   - `src/app/(app)/(onboarded)/create/page.tsx` (the Create hub; lines 58–206)
   - The `UnscheduledBatchList` component (search `src/components/` for it; it's wired into `create/page.tsx` and renders cards for reviewing/cancelled batches)
2. **Create the list page.** `src/app/(app)/(onboarded)/schedule-posts/page.tsx` should:
   - Server-fetch the current user's in-flight batches via `postService.getUnscheduledBatchesForUser` (post-service.ts:586) **filtered to `reviewing` status only** (cancelled batches will live on `/cancelled-posts` after Wave 2). For Wave 1 specifically, you may still receive cancelled batches in the query result — it's OK to also render them here for the duration of Wave 1; task-07 in Wave 2 strips cancelled out.
   - Render the same `UnscheduledBatchList` (or an equivalent cards layout) used today on `/create`. Each card links to `/schedule-posts/[batchId]`.
   - Empty state copy when there are no in-flight batches: a single sentence + a single action. Suggested: "No posts in review. Create a new set from Create Posts →" with the link pointing at `/create`. Follow brand voice — no exclamation points.
   - Wrap in the standard editorial-content container pattern from `DESIGN.md` (§ 8 Pattern B): `container mx-auto px-5 sm:px-8 lg:px-12 max-w-3xl mx-auto space-y-8`.
   - Page title (Fraunces `text-2xl tracking-tight font-medium`): "Schedule Posts".
3. **Create the detail page.** `src/app/(app)/(onboarded)/schedule-posts/[batchId]/page.tsx` should:
   - Take the batchId from the dynamic segment.
   - Reuse today's `/posts/page.tsx` rendering logic verbatim. The simplest implementation: move that file's contents into the new file and adjust for the path-based batchId (today's file reads `searchParams.batchId`; the new file reads `params.batchId`).
   - Keep the three branching renderings exactly as today: `<NetworkWizard>` when batch status is `reviewing`, `<LockedSummary>` when `scheduling`, and `<NetworkWizard mode="cancelled">` when `cancelled` (cancelled-recovery flow stays available from `/schedule-posts/[batchId]` even after Wave 2 moves the list entry to `/cancelled-posts`).
4. **Update the generator's post-success redirect.** In `src/app/(app)/(onboarded)/create/actions.ts`, find the `redirect("/posts?batchId=...")` (or similar) at the end of `generateWeeklyAction`. Change it to `redirect(\`/schedule-posts/\${batchId}\`)`. Confirm a successful generation lands the user in the review view of the new batch.
5. **Strip the in-flight cards from `/create`.** In `src/app/(app)/(onboarded)/create/page.tsx`, remove the JSX block (and any unused imports) that renders the unscheduled batch list. Leave the "Start new batch" form and gating logic intact — Wave 3 task-09 rebuilds the whole page.
6. **Add a sidebar entry for Schedule Posts.** In `src/components/dashboard/sidebar.tsx`, append a new item `{ label: "Schedule Posts", href: "/schedule-posts", icon: ClipboardList }` to the items array. Don't worry about position — task-04 reorders the array.
7. **Don't delete `/posts/page.tsx` yet.** task-05 (server redirects) will handle `/posts` → `/schedule-posts` at the routing layer. If you delete the `/posts/page.tsx` here, you'd break the redirect destination check. Keep the file; task-05 deletes it after wiring the redirect in `next.config.ts`. (Note: actually `next.config.ts` redirects fire before route resolution, so it would be safe to delete — but coordinating the deletion with task-05 keeps the diff clean.)
8. Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
9. Dev-server smoke test: go to `/schedule-posts`, see the cards. Click into one, land at `/schedule-posts/[batchId]` in the wizard. Generate a new batch from `/create` and verify the success-path lands at `/schedule-posts/[new-batch-id]`.

### Code Snippets

Replicate the existing branching from `posts/page.tsx`. Pseudocode:

```tsx
// src/app/(app)/(onboarded)/schedule-posts/[batchId]/page.tsx
export default async function Page({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batch = await postService.getBatchById(batchId);

  if (!batch) notFound();

  if (batch.status === "reviewing") return <NetworkWizard batch={batch} />;
  if (batch.status === "scheduling") return <LockedSummary batch={batch} />;
  if (batch.status === "cancelled") return <NetworkWizard batch={batch} mode="cancelled" />;

  notFound();
}
```

Exact prop names and helpers should mirror what `posts/page.tsx` does today — copy faithfully rather than re-deriving.

### Notes on what NOT to change

- Do not touch the `NetworkWizard` or `LockedSummary` components themselves.
- Do not change generation logic (no edits to `postService.generateWeekly`).
- Do not add the `next.config.ts` redirect — task-05 owns that.
- Do not delete `/posts/page.tsx` — task-05 coordinates the cleanup.
- Do not change the sidebar order or remove Currently Posting — task-04 owns those.

## Acceptance Criteria

- [ ] `/schedule-posts` renders a list of in-flight batches; clicking a card navigates to `/schedule-posts/[batchId]`.
- [ ] `/schedule-posts/[batchId]` renders the same review/edit/regen/schedule experience as today's `/posts?batchId=[id]` — wizard for reviewing, LockedSummary for scheduling, cancelled-mode wizard for cancelled.
- [ ] Generation flow: starting a new batch from `/create` and waiting for completion lands the user at `/schedule-posts/[new-batch-id]` (NOT `/posts?batchId=...`).
- [ ] `/create` no longer renders the UnscheduledBatchList block; the "Start new batch" form is still there.
- [ ] Sidebar has a new "Schedule Posts" item (position unimportant for this task).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
- [ ] Empty state on `/schedule-posts` follows brand voice (one sentence + one action, no exclamation points).

## Notes

- Pro users can have multiple unscheduled batches at once (per `batchOrdinalInPeriod` 1–4). The list view should handle 0, 1, or many cards cleanly — same as `UnscheduledBatchList` does today on `/create`.
- This task creates path-based dynamic routing (`/schedule-posts/[batchId]`) where the current page uses query-string routing (`/posts?batchId=X`). That's intentional and matches the user's approved decision.
- The cancelled-recovery flow (NetworkWizard in `cancelled` mode) stays accessible from both `/schedule-posts/[batchId]` (for direct URLs) and from `/cancelled-posts` rows (after Wave 2). They're different entry points to the same wizard — no duplication of logic.
