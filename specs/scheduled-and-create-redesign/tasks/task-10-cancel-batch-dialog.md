# Task 10: CancelBatchDialog component

## Status
not started

## Wave
4

## Description

Confirm dialog shown when the user clicks `[Cancel batch]` on a `<ScheduledBatchBox />`. Stage-1 copy: `"All N posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule."` The dialog accepts `alreadyPostedCount` and `queuedCount` props as a **dormant contract** for Phase 7 — when posting-service ships and `alreadyPostedCount > 0`, the dialog renders a split block showing already-posted vs. to-be-cancelled without component changes.

Submits via a server action that calls `postService.stopBatch()`.

## Dependencies

**Depends on:** none for the dialog UI; consumes `stopBatch()` (already exists at `src/lib/services/post-service.ts:898–939`).
**Blocks:** task-11 (page wires the dialog state).
**Parallel with:** task-08, task-09.

## Files to Modify

- `src/components/schedule/cancel-batch-dialog.tsx` (new) — dialog UI.
- `src/app/(app)/(onboarded)/schedule/actions.ts` (new) — `cancelBatchAction(batchId)` server action.

## Implementation Steps

### 1. Server action

```ts
// schedule/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

export async function cancelBatchAction(
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  try {
    await postService.stopBatch(batchId, session.user.id);
  } catch (e) {
    if (e instanceof Error && e.message === "not_scheduling") {
      return { ok: false, error: "already_cancelled" };
    }
    if (e instanceof Error && e.message === "not_owner") {
      return { ok: false, error: "not_owner" };
    }
    throw e;
  }

  revalidatePath("/schedule");
  revalidatePath("/create");  // cancelled batch re-appears here
  return { ok: true };
}
```

`stopBatch()` already returns / throws the right errors per `post-service.ts:898–939`; mirror its error names exactly.

### 2. Dialog component

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
import { cancelBatchAction } from "@/app/(app)/(onboarded)/schedule/actions";

type Props = {
  batchId: string;
  totalPosts: number;
  alreadyPostedCount?: number;   // default 0 — dormant
  queuedCount?: number;          // default = totalPosts — dormant
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;        // task-11 may want to close + refresh
};

export function CancelBatchDialog({
  batchId,
  totalPosts,
  alreadyPostedCount = 0,
  queuedCount,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const [pending, startTransition] = useTransition();
  const effectiveQueued = queuedCount ?? totalPosts;
  const showSplit = alreadyPostedCount > 0;

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelBatchAction(batchId);
      if (!result.ok) {
        toast.error(
          result.error === "already_cancelled"
            ? "This batch was already cancelled."
            : "Couldn't cancel this batch.",
        );
        return;
      }
      toast.success("Batch cancelled — returned to Create Posts.");
      onSuccess?.();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Cancel batch
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-base leading-7 text-muted-foreground">
          {showSplit
            ? `${effectiveQueued} ${effectiveQueued === 1 ? "post" : "posts"} will be cancelled. The batch will return to Create Posts so you can edit and re-schedule.`
            : `All ${totalPosts} posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule.`}
        </DialogDescription>

        {showSplit && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground mb-1">
                Already posted ({alreadyPostedCount})
              </p>
              <p className="text-foreground">Stay live on their platforms.</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-muted-foreground mb-1">
                Will be cancelled ({effectiveQueued})
              </p>
              <p className="text-foreground">
                Posts return to Create Posts for editing.
              </p>
            </div>
          </div>
        )}

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
            {pending
              ? "Cancelling…"
              : `Cancel ${effectiveQueued} ${effectiveQueued === 1 ? "post" : "posts"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 3. Stage-1 copy verification

The Stage-1 caller (task-11) always passes `alreadyPostedCount={0}` and `queuedCount={totalPosts}` (or omits them). The component default values produce the same result. Stage-1 users only see:

> All 7 posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule.

> [Keep batch] [Cancel 7 posts]

### 4. Dormant activation contract

When Phase 7 ships:
- `getScheduledViewForUser()` populates `alreadyPostedCount > 0` and `queuedCount < totalPosts` for batches mid-posting.
- The page passes those values through to the dialog.
- The dialog automatically renders the split block (Already posted / Will be cancelled).
- `stopBatch()` (extended in Phase 7) preserves the posted rows.

**No component change required.** This is the contract.

### 5. Voice & tokens

- `Cancel batch` headline — Fraunces, tracking-tight (DESIGN.md §4).
- Destructive button per DESIGN.md §9 — `bg-destructive` (warm coral, not red).
- Sonner toasts per DESIGN.md §9 (info on success, error on failure).
- No exclamation points (§14).

## Acceptance Criteria

- [ ] Default copy: `"All N posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule."`
- [ ] Split block only renders when `alreadyPostedCount > 0`.
- [ ] Confirm button label: `"Cancel N posts"` (singular when N=1).
- [ ] Submit calls `cancelBatchAction(batchId)`; on success, refreshes `/schedule` and `/create`, closes dialog, shows success toast.
- [ ] On `not_scheduling` error: shows `"This batch was already cancelled."` toast.
- [ ] Pending state disables both buttons.
- [ ] Headline uses Fraunces; body uses Geist.
- [ ] Cancel button uses `variant="destructive"`; Keep button uses `variant="ghost"`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- `revalidatePath("/create")` is critical: the cancelled batch reappears on Create Posts as a card. Without this, the user's next navigation to `/create` would still show stale data until a full page reload.
- The destructive button uses DESIGN.md's warm coral. It still conveys "this is permanent enough to confirm" but stays in the gold family per the brand.
- `useTransition` gives a pending state and keeps the UI responsive during the server action; standard Next.js 15 pattern.

## Out of scope

- A "reason for cancelling" prompt. Out of scope — Stage-1 cancel is binary.
- Undo / soft-cancel. The cancelled batch is recoverable via `reschedule()` from the wizard; the dialog doesn't surface that here.
- Per-day post details inside the dialog. The split-block "Mon · Tue · Wed" preview from the original mock is deferred until Phase 4 has real scheduled times to show.
- Bulk cancel (multiple batches). Per-box action only.
