"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteAllLibraryImagesAction } from "@/app/(app)/(onboarded)/library/actions";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirmation for the header "Delete all" button. Always deletes ONLY
 * unlocked images — the "Delete all including locked" path lives in the
 * post-download popup and is reachable only by the user choosing it
 * after downloading copies first.
 */
export function DeleteAllConfirmationDialog({ open, onOpenChange }: Props) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteAllLibraryImagesAction("unlocked-only");
      if (!result.ok) {
        toast.error("Couldn't delete images.");
        onOpenChange(false);
        return;
      }
      toast.success(
        result.deleted === 0
          ? "No unlocked images to delete."
          : `Deleted ${result.deleted} ${result.deleted === 1 ? "image" : "images"}.`,
      );
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Delete all unlocked images?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-base leading-7 text-muted-foreground">
          Locked images will be kept. Unlocked images will be permanently
          deleted. This cannot be undone.
        </DialogDescription>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
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
