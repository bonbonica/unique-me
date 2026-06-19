"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { cancelPostAction } from "@/app/(app)/(onboarded)/posting-soon/[batchId]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Per-post cancel confirmation dialog (Stage-2 §6.11).
 *
 * **Button variant is `outline` — NOT `destructive`.** Per the Cancel-vs-Delete
 * contract (§0, D-S2-6), cancel is non-destructive: the post family is
 * preserved, the image stays attached, and the action is reversible via
 * `<RestorePostDialog />`. The dialog copy is verbatim from §6.11 so the user
 * knows the scope is cross-network (every network the post was set to publish
 * on) and that restore is available later on the same page.
 *
 * Mirrors the Stage-1 `<CancelBatchDialog />` shape: `useTransition` for
 * pending state, Sonner toasts for outcome, calls the server action which
 * handles `revalidatePath` of `/schedule/[batchId]` + `/schedule`.
 */
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
      toast.success("Post cancelled. Restore it from this page.");
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
          It will be unscheduled on every network it was set to publish on. You
          can restore it from this page later. The image stays attached.
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
            variant="outline"
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
