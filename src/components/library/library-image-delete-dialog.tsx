"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteLibraryImageAction } from "@/app/(app)/(onboarded)/library/actions";
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
  libraryImageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirmation dialog for permanently deleting a single library image
 * (D-S2-18 / spec §6.13). Mirrors `<CancelBatchDialog />` in shape —
 * `useTransition`, Sonner toasts, server-action call — but this action is
 * truly destructive (the blob is `del()`-ed by `imageService.deleteLibraryImage`),
 * so the confirm button uses `variant="destructive"` and the copy says "forever".
 *
 * The dialog closes on success AND on the `not_found` race (someone deleted
 * the same image in another tab); the page revalidates via `revalidatePath`
 * inside the action, so the tile disappears on the next paint.
 */
export function LibraryImageDeleteDialog({
  libraryImageId,
  open,
  onOpenChange,
}: Props) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteLibraryImageAction(libraryImageId);
      if (!result.ok) {
        toast.error(
          result.error === "not_found"
            ? "Image was already removed."
            : "Couldn't delete this image.",
        );
        onOpenChange(false);
        return;
      }
      toast.success("Image deleted.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Delete this image forever?
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-base leading-7 text-muted-foreground">
          The image is removed from your library and the underlying file is
          deleted. This cannot be undone.
        </DialogDescription>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep
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
