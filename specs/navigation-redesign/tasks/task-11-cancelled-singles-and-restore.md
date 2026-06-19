# Task 11: Cancelled single posts section + restore action with time-picker fallback

## Status

pending

## Wave

4

## Description

Populate section 2 of `/cancelled-posts` ("Cancelled single posts") with cancelled `scheduled_posts` rows for the user. Each row has a "Restore" action. Restore behavior: if the cancelled post's original `scheduledTime > now`, call `postService.restorePost(...)` directly — it returns to its original slot. If the original `scheduledTime` is in the past, open a small time-picker Dialog to let the user choose a new time, then restore with the chosen time.

## Dependencies

**Depends on:** task-03 (section 2 placeholder file exists), task-08, task-09 (Wave 3 baseline), task-10 (UX language for cancel/restore stays consistent)
**Blocks:** task-12, task-13 (Wave 5 sweep includes this new surface)

**Context from dependencies:** task-03 created `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-single-posts-section.tsx` as a placeholder. task-10 added the cancel UX in Posting Soon; cancelled single posts now exist as `scheduled_posts` rows with `status = 'cancelled'`. This task makes them visible + recoverable.

## Files to Create

- `src/app/(app)/(onboarded)/cancelled-posts/_components/restore-post-button.tsx` — client component; the row-level Restore action with optional time-picker Dialog.
- `src/app/(app)/(onboarded)/cancelled-posts/actions.ts` — server actions: `restoreSinglePostAction(scheduledPostId)` and `restoreSinglePostWithTimeAction(scheduledPostId, newScheduledTime)`.

## Files to Modify

- `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-single-posts-section.tsx` — replace placeholder body with real data fetching + row rendering.
- `src/lib/services/post-service.ts` — add `getCancelledScheduledPostsForUser(userId)` returning all cancelled `scheduled_posts` rows for the user with the fields needed to render: `id, postId, platform, scheduledTime, batchId, batchTheme, postSnippet`. Order by `scheduledTime desc` (or by `updatedAt desc` if `cancelledAt` is stamped there).
- `src/lib/services/post-service.ts` — if `restorePost` doesn't accept a `newScheduledTime` override, add an overload `restorePost(scheduledPostId, opts?: { newScheduledTime?: Date })` that flips `status: 'cancelled' → 'pending'` AND updates `scheduledTime` if provided.

## Technical Details

### Implementation Steps

1. **Query cancelled scheduled posts.** Add `getCancelledScheduledPostsForUser(userId)` to `post-service.ts`. SQL approximation:

   ```sql
   SELECT
     sp.id,
     sp.post_id,
     sp.platform,
     sp.scheduled_time,
     wb.id AS batch_id,
     wb.theme AS batch_theme,
     SUBSTRING(p.post_text, 1, 80) AS post_snippet
   FROM scheduled_posts sp
   JOIN posts p ON p.id = sp.post_id
   JOIN weekly_batches wb ON wb.id = p.batch_id
   WHERE wb.user_id = ?
     AND sp.status = 'cancelled'
   ORDER BY sp.scheduled_time DESC
   ```

   Translate to Drizzle in the project's style.
2. **Render the section.** `cancelled-single-posts-section.tsx`:

   ```tsx
   import { auth } from "@/lib/auth";
   import { postService } from "@/lib/services/post-service";
   import { CancelledSinglePostRow } from "./cancelled-single-post-row";

   export async function CancelledSinglePostsSection() {
     const session = await auth();
     if (!session?.user?.id) return null;
     const rows = await postService.getCancelledScheduledPostsForUser(session.user.id);

     return (
       <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4">
         <header className="flex items-baseline justify-between">
           <h2 className="text-2xl font-medium tracking-tight font-fraunces">Cancelled single posts</h2>
           {rows.length > 0 && (
             <span className="text-xs text-muted-foreground tabular-nums">{rows.length}</span>
           )}
         </header>
         {rows.length === 0 ? (
           <p className="text-sm text-muted-foreground">Nothing cancelled.</p>
         ) : (
           <ul className="divide-y divide-border">
             {rows.map((r) => (
               <li key={r.id} className="py-4">
                 <CancelledSinglePostRow row={r} />
               </li>
             ))}
           </ul>
         )}
       </section>
     );
   }
   ```

3. **Row component.** `cancelled-single-post-row.tsx`:
   - Identity: post snippet (first ~80 chars) + platform badge + original scheduled time (formatted relative or absolute).
   - Right side: `<RestorePostButton scheduledPostId={r.id} originalTime={r.scheduledTime} />`.
4. **Restore button + time-picker Dialog.** `restore-post-button.tsx` (client):

   ```tsx
   "use client";
   import { useState, useTransition } from "react";
   import { Button } from "@/components/ui/button";
   import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
   import { restoreSinglePostAction, restoreSinglePostWithTimeAction } from "../actions";

   export function RestorePostButton({
     scheduledPostId,
     originalTime,
   }: {
     scheduledPostId: string;
     originalTime: Date;
   }) {
     const [open, setOpen] = useState(false);
     const [newTime, setNewTime] = useState<Date | null>(null);
     const [isPending, startTransition] = useTransition();

     function onClick() {
       const inFuture = originalTime.getTime() > Date.now();
       if (inFuture) {
         startTransition(async () => {
           await restoreSinglePostAction(scheduledPostId);
         });
       } else {
         setOpen(true);
       }
     }

     function onConfirmWithTime() {
       if (!newTime) return;
       startTransition(async () => {
         await restoreSinglePostWithTimeAction(scheduledPostId, newTime);
         setOpen(false);
       });
     }

     return (
       <>
         <Button size="sm" variant="outline" onClick={onClick} disabled={isPending}>
           Restore
         </Button>
         <Dialog open={open} onOpenChange={setOpen}>
           <DialogContent>
             <DialogHeader>
               <DialogTitle>Pick a new time</DialogTitle>
             </DialogHeader>
             <p className="text-sm text-muted-foreground">
               The original time has already passed. Choose when to restore this post.
             </p>
             {/* Project's existing date-time picker component goes here */}
             {/* If none exists, use a minimal native <input type="datetime-local"> as a fallback */}
             <div className="flex justify-end gap-2 mt-4">
               <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
               <Button onClick={onConfirmWithTime} disabled={!newTime || isPending}>Restore</Button>
             </div>
           </DialogContent>
         </Dialog>
       </>
     );
   }
   ```

5. **Server actions.**

   ```ts
   // src/app/(app)/(onboarded)/cancelled-posts/actions.ts
   "use server";
   import { revalidatePath } from "next/cache";
   import { auth } from "@/lib/auth";
   import { postService } from "@/lib/services/post-service";

   export async function restoreSinglePostAction(scheduledPostId: string) {
     const session = await auth();
     if (!session?.user?.id) throw new Error("Unauthorized");
     await postService.restorePost(scheduledPostId, session.user.id);
     revalidatePath("/cancelled-posts");
     revalidatePath("/posting-soon");
   }

   export async function restoreSinglePostWithTimeAction(scheduledPostId: string, newScheduledTime: Date) {
     const session = await auth();
     if (!session?.user?.id) throw new Error("Unauthorized");
     await postService.restorePost(scheduledPostId, session.user.id, { newScheduledTime });
     revalidatePath("/cancelled-posts");
     revalidatePath("/posting-soon");
   }
   ```

6. **Verify `restorePost` signature.** Read post-service.ts:1839 for the current signature. If it doesn't accept a `newScheduledTime`, extend the function (small addition: when option is passed, also update `scheduled_posts.scheduled_time` in the same transaction that flips status). If extending isn't safe (e.g. the existing function is used in other flows), add a sibling `restorePostWithTime(scheduledPostId, userId, newScheduledTime)`.
7. **Time-picker primitive.** If the project has a shadcn-based `<Calendar>` / `<DateTimePicker>` component already (search `src/components/ui/`), use it. If not, the native `<input type="datetime-local">` is acceptable for v1 — note the limitation in the handoff.
8. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
9. Dev-server smoke test:
    - Cancel a single post via task-10's UI.
    - Navigate to `/cancelled-posts`, see the post in section 2.
    - Restore it. If original time was future → post returns to `/posting-soon` at original time. If original time was past → time-picker dialog → pick a future time → post lands in `/posting-soon` at chosen time.

### Notes on what NOT to change

- Do not modify the cancelled-batches section (task-06 already shipped it).
- Do not delete cancelled `scheduled_posts` rows ever — only flip status back to `'pending'`.
- Do not add restore-to-original-time logic if `originalTime` is "today but a few minutes ago" — treat past as past. The time-picker handles it.

## Acceptance Criteria

- [ ] `/cancelled-posts` section 2 lists all cancelled `scheduled_posts` rows for the user, newest first.
- [ ] Each row shows post snippet + platform + original scheduled time + a Restore button.
- [ ] Restore: if `originalTime > now`, restores immediately (no dialog) and the post returns to `/posting-soon` at the original time.
- [ ] Restore: if `originalTime <= now`, opens a time-picker dialog; on confirm, restores at the new time and the post appears on `/posting-soon` accordingly.
- [ ] Section header shows a count badge when count > 0.
- [ ] Empty state matches task-03's placeholder copy ("Nothing cancelled.").
- [ ] Server actions revalidate both `/cancelled-posts` and `/posting-soon`.
- [ ] Brand voice: no exclamation points; dialog copy minimal.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- The default ordering `ORDER BY scheduledTime DESC` shows the most-recently-cancelled-or-scheduled posts first. If the project prefers `updatedAt DESC` (matching cancel timestamp), use that instead.
- Restoring a single post does NOT restore an entire batch. Each `scheduled_posts` row is independent.
- If the project's `restorePost` already supports the time override (it might per Stage-2 spec), use it directly — no need to add a sibling function.
