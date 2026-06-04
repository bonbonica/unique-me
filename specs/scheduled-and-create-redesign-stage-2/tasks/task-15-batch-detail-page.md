# Task 15: /schedule/[batchId] detail page

## Status
not started

## Wave
5

## Description

Build the new `/schedule/[batchId]` route that renders 7 ordered day slots for a single scheduled batch, with per-post `[Cancel]` actions gated by D-S2-7 and a `[Cancel batch]` footer that reuses the Stage-1 dialog. Slots without a post render as a "skipped" empty row — no compaction, no renumbering. Server component fetches the batch + posts + scheduled_posts; a client subcomponent owns the per-post confirm dialog state.

## Dependencies

**Depends on:** task-04 (`postService.cancelPost`), task-02 (extended `getScheduledViewForUser` / shared `BatchBoxData` shape — this task reads the underlying tables directly, but the post-service additions and the `days[]` derivation pattern are the contract).
**Blocks:** none.
**Parallel with:** task-16.

## Files to Create

- `src/app/(app)/(onboarded)/schedule/[batchId]/page.tsx` — dynamic route, server component, fetches batch + posts + scheduled_posts, enforces ownership.
- `src/components/schedule/batch-detail-view.tsx` — server component orchestrator. Receives the shaped data from the page, renders header + theme + importantThing + 7 slots + footer.
- `src/components/schedule/post-day-slot.tsx` — one row per `postOrder` (1..7). Client component so it can own its own dialog open state.
- `src/components/schedule/cancel-post-dialog.tsx` — per-post cancel confirm dialog.
- `src/app/(app)/(onboarded)/schedule/[batchId]/actions.ts` — `cancelPostAction(postId, batchId)` server action.

## Files to Modify

None. The Stage-1 `<CancelBatchDialog />` at `src/components/schedule/cancel-batch-dialog.tsx` is reused as-is.

## Implementation Steps

### 1. Server action

```ts
// schedule/[batchId]/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

export async function cancelPostAction(
  postId: string,
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await postService.cancelPost(session.user.id, postId);
  if (!result.ok) return result;

  revalidatePath(`/schedule/${batchId}`);
  revalidatePath("/schedule");
  revalidatePath("/library"); // image moved to library
  return { ok: true };
}
```

`postService.cancelPost` (task-04) returns the `DeletionResult` union — `{ ok: false, error: 'already_posted' | 'not_found' | 'not_owned' }`. Mirror those keys exactly.

### 2. Server page

```tsx
// schedule/[batchId]/page.tsx
import { and, asc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { posts, scheduledPosts, weeklyBatches } from "@/lib/schema";
import { BatchDetailView } from "@/components/schedule/batch-detail-view";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { batchId } = await params;

  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.id, batchId),
        eq(weeklyBatches.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!batch) notFound();

  const postRows = await db
    .select()
    .from(posts)
    .where(eq(posts.batchId, batchId))
    .orderBy(asc(posts.postOrder));

  const postIds = postRows.map((p) => p.id);
  const scheduledRows = postIds.length
    ? await db
        .select()
        .from(scheduledPosts)
        .where(inArray(scheduledPosts.postId, postIds))
    : [];

  return (
    <BatchDetailView
      batch={batch}
      postRows={postRows}
      scheduledRows={scheduledRows}
      now={new Date()}
    />
  );
}
```

Grouping by `postId` (to pick the earliest `scheduledTime` and detect any `status === 'posted'`) happens in `<BatchDetailView />` — see step 3.

### 3. `<BatchDetailView />` (server)

Derive 7 slots from `posts.postOrder` (1..7). For each slot:

```ts
type SlotData =
  | {
      kind: "live";
      postOrder: number;
      post: { id: string; postText: string; hashtags: string | null };
      networks: Array<"facebook" | "instagram" | "linkedin">;
      scheduledTime: Date;
      canCancel: boolean;
    }
  | {
      kind: "skipped";
      postOrder: number;
    };
```

**Per-post cancel gate restated (D-S2-7):**
- `canCancel = true` only when the post has at least one `scheduled_posts` row with `scheduledTime > now()` AND no `scheduled_posts` row has `status === 'posted'`.
- If both conditions are not satisfied, render the slot **without** the `[Cancel]` button.
- The same check is re-applied server-side inside `postService.cancelPost`, so the UI gate is an affordance hide — not a security boundary.

```tsx
// batch-detail-view.tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CancelBatchDialog } from "./cancel-batch-dialog";
import { PostDaySlot } from "./post-day-slot";
import { CancelBatchTrigger } from "./cancel-batch-trigger";

export function BatchDetailView({
  batch,
  postRows,
  scheduledRows,
  now,
}: Props) {
  const byPostOrder = new Map<number, (typeof postRows)[number]>();
  for (const p of postRows) byPostOrder.set(p.postOrder, p);

  const slots: SlotData[] = [];
  for (let order = 1; order <= 7; order++) {
    const post = byPostOrder.get(order);
    if (!post) {
      slots.push({ kind: "skipped", postOrder: order });
      continue;
    }
    const sched = scheduledRows.filter((s) => s.postId === post.id);
    const hasPosted = sched.some((s) => s.status === "posted");
    const earliest = sched
      .map((s) => s.scheduledTime)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const canCancel =
      !hasPosted && !!earliest && earliest.getTime() > now.getTime();

    slots.push({
      kind: "live",
      postOrder: order,
      post: {
        id: post.id,
        postText: post.postText,
        hashtags: post.hashtags,
      },
      networks: sched.map((s) => s.platform),
      scheduledTime: earliest ?? new Date(0),
      canCancel,
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-3">
        <Link
          href="/schedule"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to Scheduled
        </Link>
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          Batch {batch.batchOrdinalInPeriod} · Upcoming
        </p>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {batch.theme}
        </h1>
        {batch.importantThing && (
          <p className="text-base text-muted-foreground leading-7">
            {batch.importantThing}
          </p>
        )}
      </header>

      <section className="space-y-4" aria-label="Day slots">
        {slots.map((slot) => (
          <PostDaySlot key={slot.postOrder} slot={slot} batchId={batch.id} />
        ))}
      </section>

      <footer className="pt-8 border-t border-border">
        <CancelBatchTrigger
          batchId={batch.id}
          totalPosts={postRows.length}
        />
      </footer>
    </div>
  );
}
```

`<CancelBatchTrigger />` is a small client wrapper inside this task that opens the existing `<CancelBatchDialog />`. (Or inline the `useState` inside `<BatchDetailView />` and convert that subtree to client; the trigger-wrapper pattern keeps the orchestrator server-rendered.)

### 4. `<PostDaySlot />` (client)

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CancelPostDialog } from "./cancel-post-dialog";
import { Facebook, Instagram, Linkedin } from "lucide-react";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PostDaySlot({
  slot,
  batchId,
}: {
  slot: SlotData;
  batchId: string;
}) {
  const [open, setOpen] = useState(false);

  if (slot.kind === "skipped") {
    return (
      <div className="rounded-2xl border border-border bg-muted/30 p-6 italic text-muted-foreground">
        Day {slot.postOrder} — No post for this day.
      </div>
    );
  }

  const dow = DOW[slot.scheduledTime.getDay()];
  const date = slot.scheduledTime.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = slot.scheduledTime.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          {dow} {date} · {time}
        </p>
        {slot.canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
          >
            Cancel
          </Button>
        )}
      </div>
      <p className="text-base leading-7 text-foreground">
        {slot.post.postText}
      </p>
      <div className="flex items-center gap-3 text-muted-foreground">
        {slot.networks.includes("facebook") && <Facebook className="size-4" />}
        {slot.networks.includes("instagram") && <Instagram className="size-4" />}
        {slot.networks.includes("linkedin") && <Linkedin className="size-4" />}
      </div>

      {slot.canCancel && (
        <CancelPostDialog
          postId={slot.post.id}
          batchId={batchId}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
```

### 5. `<CancelPostDialog />` (client)

Mirrors the Stage-1 `<CancelBatchDialog />` pattern: `useTransition` for pending state, Sonner toasts, calls server action.

```tsx
"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cancelPostAction } from "@/app/(app)/(onboarded)/schedule/[batchId]/actions";

export function CancelPostDialog({
  postId,
  batchId,
  open,
  onOpenChange,
}: {
  postId: string;
  batchId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelPostAction(postId, batchId);
      if (!result.ok) {
        toast.error(
          result.error === "already_posted"
            ? "Already posted, can't cancel."
            : "Couldn't cancel this post.",
        );
        return;
      }
      toast.success("Post cancelled. Image saved to your Library.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Cancel this post?
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-base leading-7 text-muted-foreground">
          It will be removed from the batch. The image moves to your Image
          Library.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep post
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Cancelling…" : "Cancel post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 6. Voice & tokens

- Fraunces for the page title + dialog title (DESIGN.md §4).
- Editorial layout pattern B: `max-w-3xl mx-auto`, `space-y-8` between major regions.
- Destructive button per DESIGN.md §9 — warm coral, not crimson.
- No exclamation points.

## Acceptance Criteria

- [ ] `/schedule/[batchId]` exists; bad/foreign batchIds return `notFound()`.
- [ ] Header renders `← Back to Scheduled`, `BATCH {ordinal} · UPCOMING`, theme (Fraunces), and `importantThing` if present.
- [ ] 7 slots always render, ordered by `postOrder` 1..7.
- [ ] Missing posts render as the greyed/italic "No post for this day" skipped slot — no compaction.
- [ ] Live slots show day-of-week + date + time + post text + platform icons.
- [ ] `[Cancel]` button only renders when `scheduledTime > now()` AND no `scheduled_posts.status='posted'` exists for that post.
- [ ] Clicking `[Cancel]` opens `<CancelPostDialog />`; confirm calls `cancelPostAction`.
- [ ] Success: toast `"Post cancelled. Image saved to your Library."`, page revalidates.
- [ ] `already_posted` error: toast `"Already posted, can't cancel."`, dialog closes/stays per the pattern.
- [ ] Footer `[Cancel batch]` opens the existing Stage-1 `<CancelBatchDialog />` with the right batchId + totalPosts.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The cancel availability gate (D-S2-7) is restated above and is the load-bearing UI logic for this page: hide `[Cancel]` when `scheduledTime <= now()` OR any `scheduled_posts.status === 'posted'`. The server re-checks inside `postService.cancelPost`, so the UI hide is just affordance — not a guard.
- `batchOrdinalInPeriod` lives on `weekly_batches` already; Stage-2 does not renumber after eviction.
- Stage-2 produces only `'scheduled'` and `'cancelled'` states. `'posted'` is the Phase-7 dormant value and is included in the gate so the page handles future state correctly without churn.
- `revalidatePath('/library')` after a successful cancel is intentional — the image just moved into the Library.

## Out of scope

- Editing post text from the detail page. Read-only + cancel only in Stage 2.
- Drag-to-reorder slots. Deferred (named in spec §0).
- Undo for the per-post cancel. Deferred to the future soft-delete spec.
- Calendar view across multiple batches.
- Loading skeletons — server-rendered, instant.
