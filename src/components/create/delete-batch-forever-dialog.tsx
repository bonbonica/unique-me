"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteBatchForeverAction } from "@/app/(app)/(onboarded)/create/actions";
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
  imageCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Destructive confirm dialog for hard-deleting a cancelled batch
 * (Stage-2 task-08 / D-S2-8). Pairs with `<DeleteBatchForeverTrigger />`,
 * which owns the open state.
 *
 * Behavior:
 *   - Submits via `deleteBatchForeverAction(batchId)`, which delegates to
 *     `postService.deleteBatchForever`. The server action revalidates
 *     `/create` on success so the card disappears.
 *   - The success toast count comes from `imageCount` (prop). The current
 *     service contract returns only `{ ok: true }`, so the prop is the
 *     authoritative number — sourced from `data.totalPosts` at the call
 *     site (1:1 with images in Stage-2 per task §4 notes).
 *   - `not_found` is treated as the "lost-the-race" path: dialog closes,
 *     the user gets a soft toast explaining the card is gone. Every other
 *     error (`not_owned`, `not_cancelled`, `db_failed`, `unauthenticated`)
 *     collapses into the generic-error toast; none of those should surface
 *     for a normal user flow.
 *
 * Per DESIGN.md §9 there is no `destructive-ghost` variant, so the dismiss
 * uses `variant="ghost"` and the confirm uses `variant="destructive"`
 * (warm coral, not red). Title is Fraunces at `text-2xl` per DESIGN.md §4.
 * No exclamation points anywhere (DESIGN.md §14).
 */
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
      toast.success(
        `Batch deleted. ${imageCount} ${
          imageCount === 1 ? "image" : "images"
        } saved to your Library.`,
      );
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
