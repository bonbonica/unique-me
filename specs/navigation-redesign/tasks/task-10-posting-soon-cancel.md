# Task 10: Posting Soon — per-post cancel + bulk cancel (Select mode)

## Status

pending

## Wave

4

## Description

Add per-post cancel and bulk cancel to the `/posting-soon` page. The backend has supported per-`scheduled_posts`-row cancel since Stage-2 (`postService.cancelPost(postId, platform?)` at `src/lib/services/post-service.ts:1721`); this task wires the UI. Bulk cancel uses a "Select" mode toggle (matches the serene/uncluttered brand): in default view, posts render normally with a per-row cancel button; tapping a "Select" button enters multi-select with checkboxes on every post; a "Cancel selected" action with a confirmation dialog batches the operations.

Cancelled single posts disappear from `/posting-soon` and appear on `/cancelled-posts` (section 2 — populated in task-11).

## Dependencies

**Depends on:** task-08, task-09 (Wave 3 baseline must be stable)
**Blocks:** task-12, task-13 (Wave 5 sweeps the new UI surfaces too)

**Context from dependencies:** task-09 finished rebuilding `/create`. `/posting-soon` was renamed-only in Wave 1 (task-01) — no functional changes. This task adds the per-post and bulk cancel UX to the existing detail and list views.

## Files to Create

- `src/app/(app)/(onboarded)/posting-soon/_components/cancel-post-button.tsx` — client component, per-row cancel with inline confirmation (small Dialog).
- `src/app/(app)/(onboarded)/posting-soon/_components/select-mode-toolbar.tsx` — client component, controls the multi-select mode (toggle, "Cancel selected", count).
- `src/app/(app)/(onboarded)/posting-soon/_components/scheduled-posts-list.tsx` — client component, holds the select-mode state and renders post rows with optional checkboxes.
- `src/app/(app)/(onboarded)/posting-soon/actions.ts` — server actions: `cancelSinglePostAction(scheduledPostId)` and `cancelManyPostsAction(scheduledPostIds: string[])`.

## Files to Modify

- `src/app/(app)/(onboarded)/posting-soon/page.tsx` — pass scheduled-post data into the new client list component; render the new `<SelectModeToolbar>` above the list.
- `src/app/(app)/(onboarded)/posting-soon/[batchId]/page.tsx` — same treatment for the per-batch detail view (per-post cancel buttons; Select mode toolbar above the day-by-day grid).
- `src/lib/services/post-service.ts` — if `cancelPost` accepts only `postId` + optional `platform`, this is fine for per-`scheduled_posts`-row cancel since a row maps to (postId, platform). If the action needs a thin wrapper that accepts a `scheduledPostId` directly (cleaner API for the UI), add it as `cancelScheduledPost(scheduledPostId)`.

## Technical Details

### Implementation Steps

1. **Map the data model to UI rows.** Each row in the Posting Soon list represents one `scheduled_posts` row (one post × one platform × one scheduled time). A batch with 7 posts × 3 platforms = 21 scheduled-posts rows. Confirm the existing `/posting-soon` page reads this correctly (it likely already groups by batch then by day → networks).
2. **Per-post cancel button.** `<CancelPostButton>`:
   - Renders a small ghost icon button (Trash2 or X, 1.5 stroke, size-4) with `aria-label="Cancel this post"`.
   - On click, opens a confirmation Dialog: title "Cancel this post?", body identifying the post (`{platform} · {scheduledTime}`), buttons "Cancel post" (destructive variant) and "Keep" (ghost).
   - On confirm, calls `cancelSinglePostAction(scheduledPostId)`. On success, optimistically remove the row from the list (or `router.refresh()`).
3. **Server action `cancelSinglePostAction`.**

   ```ts
   "use server";
   export async function cancelSinglePostAction(scheduledPostId: string) {
     const session = await auth();
     if (!session?.user?.id) throw new Error("Unauthorized");
     await postService.cancelScheduledPost(scheduledPostId, session.user.id);
     revalidatePath("/posting-soon");
     revalidatePath("/cancelled-posts");
   }
   ```

   Where `cancelScheduledPost` is either the existing `cancelPost(postId, platform)` called via a (postId, platform) lookup from the scheduledPostId, OR a new thin wrapper accepting scheduledPostId directly. **Prefer the new wrapper** for UI clarity.
4. **Select mode toolbar.** `<SelectModeToolbar>`:
   - When `selectMode === false`: shows a single button labeled "Select" (outline variant, `rounded-lg`).
   - When `selectMode === true`: shows count badge ("{n} selected"), "Cancel selected" button (destructive variant), and "Done" button (ghost) to exit.
   - "Cancel selected" opens a confirmation Dialog: "Cancel {n} posts?" with "Cancel posts" / "Keep" buttons.
5. **List with optional checkboxes.** `<ScheduledPostsList>`:
   - Client component, owns `selectMode` boolean state and `selectedIds: Set<string>`.
   - When `selectMode === true`, every row has a `<Checkbox>` (shadcn) to the left of its existing content.
   - When `selectMode === false`, the per-row `<CancelPostButton>` is visible; in Select mode, the per-row button is hidden (bulk takes over).
   - Provides `setSelectMode`, `toggleSelected(id)`, and `clearSelection()`.
6. **Server action `cancelManyPostsAction`.**

   ```ts
   "use server";
   export async function cancelManyPostsAction(scheduledPostIds: string[]) {
     const session = await auth();
     if (!session?.user?.id) throw new Error("Unauthorized");
     await Promise.all(
       scheduledPostIds.map((id) => postService.cancelScheduledPost(id, session.user.id)),
     );
     revalidatePath("/posting-soon");
     revalidatePath("/cancelled-posts");
   }
   ```

   Consider wrapping in a single DB transaction for atomicity if `cancelScheduledPost` does meaningful work — match the style used by other multi-row write helpers in the codebase.
7. **Wire the components into `/posting-soon/page.tsx` and `/posting-soon/[batchId]/page.tsx`.** Both pages fetch their data server-side as today, then pass it into `<ScheduledPostsList>` (client) wrapped by `<SelectModeToolbar>`.
8. **Empty state.** If a batch has no future-pending scheduled posts (all cancelled or all already posted), the row group should show a single muted sentence (e.g. "Nothing scheduled here."). Don't render a stale skeleton.
9. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
10. Dev-server smoke test:
    - Create + schedule a batch.
    - On `/posting-soon`, cancel one post → confirm dialog → post disappears from the list.
    - Toggle Select mode → checkboxes appear → select 3 posts → "Cancel selected" → confirm → all 3 disappear.
    - Navigate to `/cancelled-posts` → cancelled singles section (still empty placeholder if task-11 hasn't shipped; once task-11 ships, they appear).

### Code Snippets

Toolbar sketch:

```tsx
"use client";
import { Button } from "@/components/ui/button";

export function SelectModeToolbar({
  selectMode,
  selectedCount,
  onEnter,
  onExit,
  onCancelSelected,
}: {
  selectMode: boolean;
  selectedCount: number;
  onEnter: () => void;
  onExit: () => void;
  onCancelSelected: () => void;
}) {
  if (!selectMode) {
    return (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onEnter}>Select</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">
        {selectedCount} selected
      </span>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={onCancelSelected} disabled={selectedCount === 0}>
          Cancel selected
        </Button>
        <Button variant="ghost" size="sm" onClick={onExit}>Done</Button>
      </div>
    </div>
  );
}
```

### Notes on what NOT to change

- Do not change the scheduling logic (no edits to `scheduleService.scheduleBatch` or equivalent).
- Do not delete cancelled `scheduled_posts` rows from the DB. `cancelPost` flips `status` to `'cancelled'` and that's how `/cancelled-posts` finds them.
- Do not modify the existing batch-level "Stop entire batch" action — that's the whole-batch cancel and stays.
- Do not add a per-post cancel to the `/schedule-posts` review/edit view — that view operates on `posts` in `reviewing` status (pre-schedule), where per-post-per-platform doesn't exist yet. Cancel applies only to scheduled posts.

## Acceptance Criteria

- [ ] `/posting-soon` shows a "Select" button in default view; each post row has a small per-row cancel control.
- [ ] Single-post cancel works: confirmation dialog → on confirm, post disappears from `/posting-soon`.
- [ ] Select mode toggles checkboxes on every row; "Cancel selected" with confirmation dialog cancels all checked posts in one action.
- [ ] Cancelled single posts no longer appear on `/posting-soon`.
- [ ] `/posting-soon/[batchId]` (detail view) has the same per-post + Select behavior.
- [ ] Server actions revalidate `/posting-soon` and `/cancelled-posts` so the cancelled posts immediately appear in section 2.
- [ ] Brand voice: confirmation dialogs read as plain confident sentences. No exclamation points.
- [ ] Touch targets ≥ 44px for the per-row cancel button (use `h-11 w-11` or `size-icon` for the icon button).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- The user explicitly chose "Select mode toggle" over "always-visible checkboxes" — preserve the calm default view.
- If a scheduled-post row is already past its `scheduledTime` (publishing has either fired or is mid-fire), the cancel button should either be disabled with a tooltip ("Already posted or in flight") or hidden. Use `cancelPost`'s availability gate (D-S2-7 per exploration: rejects if any row is already posted) to drive that state.
- This task adds new server actions but does NOT touch the underlying `cancelPost` / `restorePost` backend logic.
