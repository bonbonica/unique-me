"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { restorePostAction } from "@/app/(app)/(onboarded)/posting-soon/[batchId]/actions";
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
 * Per-post restore confirmation dialog (Stage-2 D-S2-21).
 *
 * Symmetric to `<CancelPostDialog />` but for the constructive direction.
 * **Primary button variant is `default` (champagne)** — restore is a
 * constructive action, not a destructive one. Copy is the §6.11 verbatim text
 * for the restore flow: re-schedules on every network the post was originally
 * set to publish on, and explicitly notes the image is still attached (it
 * never moved on cancel — see Cancel-vs-Delete contract at §0).
 *
 * Calls `restorePostAction` which delegates to `postService.restorePost`. The
 * service re-applies the D-S2-21 availability gate; if the gate is closed
 * (e.g. the schedule time has passed since the user opened the dialog), the
 * action returns `not_restorable` and the dialog surfaces "This post can't be
 * restored."
 */
export function RestorePostDialog({
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
      const result = await restorePostAction(postId, batchId);
      if (!result.ok) {
        toast.error(
          result.error === "not_restorable"
            ? "This post can't be restored."
            : "Couldn't restore this post.",
        );
        return;
      }
      toast.success("Post restored.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Restore this post?
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-base leading-7 text-muted-foreground">
          It will be re-scheduled on every network it was originally set to
          publish on. The image is still attached.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Not now
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Restoring…" : "Restore post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
