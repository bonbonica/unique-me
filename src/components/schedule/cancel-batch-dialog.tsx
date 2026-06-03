"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cancelBatchAction } from "@/app/(app)/(onboarded)/schedule/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  batchId: string;
  totalPosts: number;
  /** Stage-1 dormant — defaults to 0; Phase 7 will populate from posted rows. */
  alreadyPostedCount?: number;
  /** Stage-1 dormant — defaults to `totalPosts`; Phase 7 will subtract posted. */
  queuedCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional hook for the caller (e.g. clear cancel-target state). */
  onSuccess?: () => void;
};

/**
 * Confirmation dialog for cancelling a `scheduling` batch.
 *
 * Stage-1 always passes `alreadyPostedCount === 0`, so the split block stays
 * hidden and users see the unified copy "All N posts will be cancelled...".
 *
 * Dormant contract (Phase 7): when the data layer starts producing
 * `alreadyPostedCount > 0`, the split block renders automatically — no
 * component change required. The prop signature is the contract.
 */
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
            : `All ${totalPosts} ${totalPosts === 1 ? "post" : "posts"} will be cancelled. The batch will return to Create Posts so you can edit and re-schedule.`}
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
