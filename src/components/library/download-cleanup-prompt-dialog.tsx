"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteAllLibraryImagesAction } from "@/app/(app)/(onboarded)/library/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Surfaced immediately after the user clicks "Download all". Offers two
 * destructive options or a no-op close. The X in the top-right is provided
 * by the shadcn DialogContent (showCloseButton defaults to true) — that's
 * the "close without deleting anything" path per the spec.
 */
export function DownloadCleanupPromptDialog({ open, onOpenChange }: Props) {
  const [pending, startTransition] = useTransition();

  function handleDelete(mode: "all" | "unlocked-only") {
    startTransition(async () => {
      const result = await deleteAllLibraryImagesAction(mode);
      if (!result.ok) {
        toast.error("Couldn't delete images.");
        onOpenChange(false);
        return;
      }
      toast.success(
        result.deleted === 0
          ? "No images to delete."
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
            Download started
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-base leading-7 text-muted-foreground">
          Your library is downloading. Now that you have copies, do you want
          to clear the library?
        </DialogDescription>

        <div className="flex flex-col gap-3">
          <Button
            variant="destructive"
            onClick={() => handleDelete("all")}
            disabled={pending}
          >
            Delete all images (including locked)
          </Button>
          <Button
            variant="outline"
            onClick={() => handleDelete("unlocked-only")}
            disabled={pending}
          >
            Delete only unlocked
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
