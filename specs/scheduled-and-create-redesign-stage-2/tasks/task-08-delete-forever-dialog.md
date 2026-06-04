# Task 08: DeleteBatchForeverDialog + wire `[Delete forever]` button

## Status
not started

## Wave
3

## Description

Create the destructive confirm dialog for hard-deleting a cancelled batch (per spec §6.3) and wire a new secondary `[Delete forever]` button on the cancelled-state `<UnscheduledBatchCard />`, sitting to the right of the primary `Open to reschedule →` CTA from task-07. The dialog explains image preservation, calls `postService.deleteBatchForever` through a server action, surfaces success / not-found toasts, and revalidates `/create` so the card disappears.

Only `cancelled` cards render this button. `reviewing` cards are untouched.

## Dependencies

**Depends on:** task-05 (server-side `postService.deleteBatchForever` exists in `post-service.ts` with the D-S2-8 contract), **task-07** (chip + primary CTA copy land first — this task re-edits the same `unscheduled-batch-card.tsx` and adds a sibling Button next to the CTA task-07 touched).
**Blocks:** none.
**Parallel with:** task-09, task-10 (different files) — but **NOT parallel with task-07** within Wave 3, even though both are in the same wave. Both tasks edit `src/components/create/unscheduled-batch-card.tsx`. Implementation order: task-07 commits the chip + CTA copy fixes first; task-08 then opens the post-task-07 file and adds the Delete-forever Button + dialog wiring. The second commit must rebase / land on top of task-07's so the diffs stack cleanly.

## Files to Create

- `src/components/create/delete-batch-forever-dialog.tsx` (new) — confirm dialog UI + submit logic.
- `src/app/(app)/(onboarded)/create/actions.ts` (new OR modified — create if it doesn't exist, append if task-07 / Wave 2 already created it) — `deleteBatchForeverAction(batchId)` server action.

## Files to Modify

- `src/components/create/unscheduled-batch-card.tsx` — add the `[Delete forever]` Button next to the existing CTA, gated to `data.status === "cancelled"`. Hosts dialog open state via a small client-component wrapper (the card itself stays a server component; see step 4).

## Implementation Steps

### 1. Server action

Create `src/app/(app)/(onboarded)/create/actions.ts` (or append, if it already exists):

```ts
"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

export async function deleteBatchForeverAction(
  batchId: string,
): Promise<
  | { ok: true; imageCount: number }
  | { ok: false; error: "unauthenticated" | "not_found" | "not_owned" | "not_cancelled" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await postService.deleteBatchForever(session.user.id, batchId);
  if (!result.ok) return result;

  revalidatePath("/create");
  return result;
}
```

Mirror task-05's `deleteBatchForever` return shape exactly. If task-05 returns `{ ok: true, imageCount: number }`, surface that here; if it returns plain `{ ok: true }`, the dialog falls back to its prop-passed `imageCount` for the toast string.

### 2. Dialog component

`src/components/create/delete-batch-forever-dialog.tsx`:

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
import { deleteBatchForeverAction } from "@/app/(app)/(onboarded)/create/actions";

type Props = {
  batchId: string;
  imageCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DeleteBatchForeverDialog({
  batchId,
  imageCount,
  open,
  onOpenChange,
}: Props) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteBatchForeverAction(batchId);
      if (!result.ok) {
        toast.error(
          result.error === "not_found"
            ? "This batch was already removed."
            : "Couldn't delete this batch.",
        );
        onOpenChange(false);
        return;
      }
      const n = "imageCount" in result ? result.imageCount : imageCount;
      toast.success(`Batch deleted. ${n} images saved to your Library.`);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Delete this batch forever?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-base leading-7 text-muted-foreground">
          The batch and its posts will be removed. {imageCount}{" "}
          {imageCount === 1 ? "image" : "images"} will move to your Image
          Library so you can reuse them.
        </DialogDescription>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep batch
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Per DESIGN.md §9: `variant="destructive"` for the confirm (warm coral, not red), `variant="ghost"` for the dismiss. Fraunces title at `text-2xl` per DESIGN.md §4.

### 3. Per-card client wrapper

`<UnscheduledBatchCard />` is a server component and must stay one — only the cancelled-card branch needs `useState` for dialog open. Add a small client wrapper *inside* the same file (or as a sibling co-located component) that owns the open-state for the dialog + trigger button:

```tsx
"use client";
// Co-located in unscheduled-batch-card.tsx OR in
// src/components/create/delete-batch-forever-trigger.tsx — caller's choice.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DeleteBatchForeverDialog } from "./delete-batch-forever-dialog";

export function DeleteBatchForeverTrigger({
  batchId,
  imageCount,
}: {
  batchId: string;
  imageCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive hover:bg-destructive/10"
      >
        Delete forever
      </Button>
      <DeleteBatchForeverDialog
        batchId={batchId}
        imageCount={imageCount}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
```

Per DESIGN.md §9 there is no `destructive-ghost` button variant — compose `variant="ghost"` + `text-destructive hover:bg-destructive/10` for the secondary destructive affordance (mirrors the DropdownMenu destructive-item pattern in §9).

### 4. Insert the trigger into the cancelled card

In `src/components/create/unscheduled-batch-card.tsx`, the action row (currently containing one `<Button asChild>` for the primary CTA) becomes a two-button group when `data.status === "cancelled"`:

```tsx
<div className="flex items-center gap-2">
  {data.status === "cancelled" && (
    <DeleteBatchForeverTrigger
      batchId={data.id}
      imageCount={data.totalPosts}
    />
  )}
  <Button asChild size="sm">
    <Link href={`/posts?batchId=${data.id}`}>
      {CTA_LABEL[data.status]}
      <ArrowRight
        className="ml-1 size-4"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </Link>
  </Button>
</div>
```

`Delete forever` sits **left** of the primary CTA so the champagne `Open to reschedule →` retains right-edge prominence (single primary CTA per DESIGN.md §1 / §9 — destructive sits in the supporting position).

`imageCount` is sourced from `data.totalPosts` here as a pragmatic approximation — Stage-2 post images are 1:1 with posts in current data, so post count = image count for the toast / dialog. If task-05 exposes a real `imageCount` field on the row shape, prefer that.

### 5. Voice / copy strings (exact)

- Dialog title: `"Delete this batch forever?"`
- Dialog body: `"The batch and its posts will be removed. {N} images will move to your Image Library so you can reuse them."` (singular `image` when N=1).
- Dismiss button: `"Keep batch"`.
- Confirm button: `"Delete"` (pending: `"Deleting…"`).
- Success toast: `"Batch deleted. {N} images saved to your Library."`
- `not_found` error toast: `"This batch was already removed."`
- Generic error toast: `"Couldn't delete this batch."`

All match DESIGN.md §14 voice (no exclamation; plain confident verbs; middle dot not used here because the strings are full sentences).

## Acceptance Criteria

- [ ] `delete-batch-forever-dialog.tsx` renders with Fraunces title at `text-2xl`, body in muted Geist, two-button footer (`Keep batch` ghost, `Delete` destructive).
- [ ] `[Delete forever]` button only renders on cards where `data.status === "cancelled"`.
- [ ] Trigger Button uses `variant="ghost"` + `text-destructive hover:bg-destructive/10` per DESIGN.md §9.
- [ ] Primary `Open to reschedule →` CTA stays the right-most action on the row.
- [ ] Confirm submits via `deleteBatchForeverAction(batchId)`; success toast reads exactly `"Batch deleted. {N} images saved to your Library."`
- [ ] `not_found` error toast reads exactly `"This batch was already removed."`
- [ ] Server action calls `revalidatePath('/create')` on success; the cancelled card disappears from the list after submit.
- [ ] Pending state disables both dialog buttons; trigger button is not disabled (dialog handles its own pending).
- [ ] Dialog closes on success AND on `not_found` (the card is gone either way).
- [ ] No exclamation points (DESIGN.md §14). No emojis.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- **Sequencing with task-07.** Both tasks edit `unscheduled-batch-card.tsx`. Task-07's diff is the chip label + `CTA_LABEL` lookup; task-08's diff inserts the `<DeleteBatchForeverTrigger>` next to the now-`CTA_LABEL[data.status]`-driven CTA. Land task-07 first; task-08's edit then has no conflict with task-07 and references the `CTA_LABEL` constant task-07 introduced. If both tasks are picked up in parallel, task-08 must rebase on task-07's commit before merging.
- The dialog uses Sonner per DESIGN.md §9. The success toast format mirrors the cancel-batch toast `"Batch cancelled — returned to Create Posts."` — short factual sentence ending in a period.
- Image-count display is a best-effort estimate from `data.totalPosts` (1 image per post in Stage-2). If task-05 surfaces an authoritative `imageCount` on the row shape, the dialog reads it from the server-action return for the success toast.

## Out of scope

- Hard-deleting `reviewing` batches. Reviewing uses the existing wizard discard flow — D-S2-8 explicitly excludes it.
- An undo affordance. Per spec §0, Stage-2 has no undo until the future soft-delete spec lands.
- A separate `[Delete forever]` action on `/schedule`. Scheduled batches don't render this control — Stage-2 only exposes it on `/create` cancelled cards.
- Library-cap overflow toasts (`"Oldest image replaced to make room."`). That belongs to task-03 (`imageService.retainImagesToLibrary`) — this dialog only surfaces the success/error toasts above.
