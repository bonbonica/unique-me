# Task 11: Populate Cancelled Posts list + REPOST action

## Status

pending

## Wave

4

## Description

**Rewritten 2026-06-19** following the single-list design pivot. Populates the single list section on `/cancelled-posts` (the shell from task-03) with every cancelled `scheduled_posts` row for the user — including both one-off per-post cancels AND posts cancelled via whole-batch cancel (task-06's `stopBatch` change makes both flow through the same `status = 'cancelled'` filter).

Each row gets a **REPOST** action. Clicking REPOST opens a small Dialog with two options:

1. **"Repost where it naturally fits the most"** — service picks the next slot that aligns with the user's posting cadence (posting days, platform spacing) and re-publishes there. Status flips `cancelled → pending` and `scheduled_time` updates to the chosen natural slot.
2. **"Pick a date"** — opens a time-picker; user chooses a new `scheduled_time`; status flips `cancelled → pending` and `scheduled_time` updates to the chosen time.

No "restore at original time" path: the original time has usually passed (the post was cancelled, then sat in the list), so we always require an explicit choice between the two options above.

## Dependencies

**Depends on:** task-03 (single-list section placeholder file exists), task-06 (so batch-cancelled posts surface in the query), task-08, task-09 (Wave 3 baseline), task-10 (per-post cancel UX language stays consistent)
**Blocks:** task-12, task-13 (Wave 5 sweep includes this new surface)

**Context from dependencies:** task-03 created `src/components/cancelled-posts/cancelled-posts-list.tsx` as a placeholder. task-06 extended `stopBatch` so batch-cancelled posts have `scheduled_posts.status = 'cancelled'` (not `'pending'`), letting the single query catch them. task-10 added per-post cancel; cancelled posts now flow into `scheduled_posts` rows with `status = 'cancelled'`.

## Files to Create

- `src/components/cancelled-posts/cancelled-post-row.tsx` — row component for one cancelled post: identity (snippet + platform + original scheduled time) + REPOST trigger.
- `src/components/cancelled-posts/repost-dialog.tsx` — client component; the two-option Dialog (natural fit | pick a date).
- `src/app/(app)/(onboarded)/cancelled-posts/actions.ts` — server actions:
  - `repostNaturalAction(scheduledPostId)`
  - `repostAtTimeAction(scheduledPostId, newScheduledTime)`

## Files to Modify

- `src/components/cancelled-posts/cancelled-posts-list.tsx` — replace placeholder body with real data fetching + row rendering.
- `src/lib/services/post-service.ts` — add (or extend existing) helpers:
  - `getCancelledScheduledPostsForUser(userId)` — returns every cancelled `scheduled_posts` row with: `id, postId, platform, scheduledTime, batchId, batchTheme, postSnippet`. Ordered `scheduledTime DESC` (or `updatedAt DESC` if the cancel timestamp lives there).
  - `repostScheduledPost(scheduledPostId, userId, opts: { mode: "natural" } | { mode: "at_time", newScheduledTime: Date })` — flips `status: cancelled → pending`, updates `scheduledTime`. For `mode: "natural"`, calls the existing scheduling service (or a thin helper) to compute the next-natural-fit slot for the post's platform + the user's posting-days preference.
- `src/lib/scheduling/...` — if there isn't already a "next natural slot" helper, add `nextNaturalFitSlot(userId, platform, fromTime?: Date)`. Reuse the same posting-days logic used by `resolveBatchPlan` (per the exploration report). Returns a `Date` in the future.

## Technical Details

### Implementation Steps

1. **Query cancelled scheduled posts.** Add `getCancelledScheduledPostsForUser(userId)` to `post-service.ts`. Drizzle-flavored:

   ```ts
   db.select({
       id: scheduledPosts.id,
       postId: scheduledPosts.postId,
       platform: scheduledPosts.platform,
       scheduledTime: scheduledPosts.scheduledTime,
       batchId: weeklyBatches.id,
       batchTheme: weeklyBatches.theme,
       postSnippet: sql<string>`SUBSTRING(${posts.postText}, 1, 80)`,
     })
     .from(scheduledPosts)
     .innerJoin(posts, eq(posts.id, scheduledPosts.postId))
     .innerJoin(weeklyBatches, eq(weeklyBatches.id, posts.batchId))
     .where(and(
       eq(weeklyBatches.userId, userId),
       eq(scheduledPosts.status, "cancelled"),
       isNull(weeklyBatches.deletedAt),
     ))
     .orderBy(desc(scheduledPosts.scheduledTime));
   ```

   Match the project's actual schema column names.
2. **Render the list section.** `cancelled-posts-list.tsx`:

   ```tsx
   import { headers } from "next/headers";
   import { auth } from "@/lib/auth";
   import { postService } from "@/lib/services";
   import { CancelledPostRow } from "./cancelled-post-row";

   export async function CancelledPostsList() {
     const session = await auth.api.getSession({ headers: await headers() });
     if (!session) return null;
     const rows = await postService.getCancelledScheduledPostsForUser(session.user.id);

     return (
       <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4">
         <header className="flex items-baseline justify-between">
           <h2 className="font-fraunces text-2xl font-medium tracking-tight">Cancelled posts</h2>
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
                 <CancelledPostRow row={r} />
               </li>
             ))}
           </ul>
         )}
       </section>
     );
   }
   ```

3. **Row component.** `cancelled-post-row.tsx`:
   - Left: post snippet (line-clamp-1) + small platform badge + original scheduled time formatted (e.g. "Was scheduled Mon Jun 22, 2:30 PM").
   - Right: `<RepostDialog scheduledPostId={r.id} />` trigger (a `<Button size="sm" variant="outline">Repost</Button>` that opens the dialog).
4. **Repost dialog.** `repost-dialog.tsx` (client):

   ```tsx
   "use client";
   import { useState, useTransition } from "react";
   import { Button } from "@/components/ui/button";
   import {
     Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
   } from "@/components/ui/dialog";
   import { repostNaturalAction, repostAtTimeAction } from "../actions";
   // Use the project's existing date-time picker if present; otherwise
   // <input type="datetime-local"> as a v1 fallback (document the swap in
   // handoff). The picker must return a Date in the future.

   export function RepostDialog({ scheduledPostId }: { scheduledPostId: string }) {
     const [open, setOpen] = useState(false);
     const [mode, setMode] = useState<"choose" | "pick-date">("choose");
     const [pickedTime, setPickedTime] = useState<Date | null>(null);
     const [isPending, startTransition] = useTransition();

     function chooseNatural() {
       startTransition(async () => {
         await repostNaturalAction(scheduledPostId);
         setOpen(false);
       });
     }
     function confirmPickDate() {
       if (!pickedTime) return;
       startTransition(async () => {
         await repostAtTimeAction(scheduledPostId, pickedTime);
         setOpen(false);
       });
     }

     return (
       <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setMode("choose"); }}>
         <DialogTrigger asChild>
           <Button size="sm" variant="outline">Repost</Button>
         </DialogTrigger>
         <DialogContent>
           <DialogHeader>
             <DialogTitle>
               {mode === "choose" ? "Repost when?" : "Pick a date"}
             </DialogTitle>
           </DialogHeader>

           {mode === "choose" ? (
             <div className="space-y-3">
               <p className="text-sm text-muted-foreground">
                 Where should this post go?
               </p>
               <div className="flex flex-col gap-2">
                 <Button onClick={chooseNatural} disabled={isPending}>
                   Repost where it naturally fits the most
                 </Button>
                 <Button variant="outline" onClick={() => setMode("pick-date")} disabled={isPending}>
                   Pick a date
                 </Button>
               </div>
             </div>
           ) : (
             <div className="space-y-3">
               {/* Project's date-time picker — bind to setPickedTime */}
               <div className="flex justify-end gap-2">
                 <Button variant="ghost" onClick={() => setMode("choose")}>Back</Button>
                 <Button onClick={confirmPickDate} disabled={!pickedTime || isPending}>
                   Repost
                 </Button>
               </div>
             </div>
           )}
         </DialogContent>
       </Dialog>
     );
   }
   ```

5. **Server actions.**

   ```ts
   // src/app/(app)/(onboarded)/cancelled-posts/actions.ts
   "use server";
   import { headers } from "next/headers";
   import { revalidatePath } from "next/cache";
   import { auth } from "@/lib/auth";
   import { postService } from "@/lib/services";

   export async function repostNaturalAction(scheduledPostId: string) {
     const session = await auth.api.getSession({ headers: await headers() });
     if (!session) throw new Error("Unauthorized");
     await postService.repostScheduledPost(scheduledPostId, session.user.id, { mode: "natural" });
     revalidatePath("/cancelled-posts");
     revalidatePath("/posting-soon");
   }

   export async function repostAtTimeAction(scheduledPostId: string, newScheduledTime: Date) {
     const session = await auth.api.getSession({ headers: await headers() });
     if (!session) throw new Error("Unauthorized");
     await postService.repostScheduledPost(scheduledPostId, session.user.id, {
       mode: "at_time",
       newScheduledTime,
     });
     revalidatePath("/cancelled-posts");
     revalidatePath("/posting-soon");
   }
   ```

6. **`repostScheduledPost` service.** Inside one transaction:
   - Ownership + state guard: load the row, confirm it belongs to the session user (via parent `posts.batchId → weeklyBatches.userId`), confirm `status = 'cancelled'`.
   - Resolve `newScheduledTime`:
     - `mode: "at_time"` → use `opts.newScheduledTime`; reject if `< now`.
     - `mode: "natural"` → call `nextNaturalFitSlot(userId, row.platform)` and use its return value.
   - Update: `scheduled_posts.status = 'pending'`, `scheduled_posts.scheduledTime = newScheduledTime`, `updatedAt = now()`.
7. **`nextNaturalFitSlot` helper.** Reuse the existing posting-days / batch-calendar logic that `resolveBatchPlan` (per exploration: `batch-calendar.ts`) uses. Conservative starter implementation: pick the next valid posting day at the user's default time-of-day for that platform; skip days that already have a same-platform `pending` post for that user; never go backwards in time. Document any assumptions in code comments.
8. **Don't surface the original `scheduledTime` as a third "restore at original" option.** The single-list design treats cancelled posts as needing a fresh decision — natural fit OR explicit date.
9. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
10. Dev-server smoke test:
    - Cancel one post via task-10's UI → see it appear in the single list on `/cancelled-posts`.
    - Cancel a whole batch via "Stop entire batch" → all of that batch's posts appear individually in the list.
    - REPOST → "natural fit" → post returns to `/posting-soon` at a sensible future slot.
    - REPOST → "pick a date" → post returns to `/posting-soon` at the chosen time.

### Notes on what NOT to change

- Do not bring back a separate "batches" section. The single-list design is locked.
- Do not delete cancelled `scheduled_posts` rows. Repost flips status back; cancelled rows stay until they're either reposted or aged out by a future cleanup task (out of scope here).
- Do not preserve the original `scheduledTime` as a third option in the dialog.
- Do not modify the per-post cancel logic (task-10) or the batch-cancel logic (task-06).

## Acceptance Criteria

- [ ] `/cancelled-posts` renders ONE list of every cancelled `scheduled_posts` row for the user.
- [ ] Both per-post cancels AND whole-batch cancels show up in the list (one row per affected post).
- [ ] Each row shows post snippet + platform + original scheduled time + REPOST button.
- [ ] REPOST opens a Dialog with two top-level options ("Repost where it naturally fits the most" + "Pick a date").
- [ ] "Natural fit" calls `nextNaturalFitSlot` and reposts there; the post appears on `/posting-soon` at the chosen slot.
- [ ] "Pick a date" opens a time-picker; on submit, reposts at the chosen time.
- [ ] Section header shows a count badge when count > 0.
- [ ] Empty state matches task-03's placeholder copy ("Nothing cancelled.").
- [ ] Server actions revalidate both `/cancelled-posts` and `/posting-soon`.
- [ ] Brand voice: no exclamation points; dialog copy minimal.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- The "natural fit" slot resolution is the riskiest piece. If the existing `batch-calendar.ts` helpers can be composed for this without inventing new logic, do so. If not, write the conservative starter implementation described in step 7 and flag in the handoff that a future task may refine the heuristic.
- If a row's platform has no upcoming valid slot (e.g. user disabled the platform after the post was cancelled), the natural-fit action should fail gracefully with a server-action error that the dialog surfaces ("Can't find a natural slot — pick a date instead.") — do NOT silently fall back.
