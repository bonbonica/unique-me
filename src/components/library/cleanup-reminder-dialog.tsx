"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  dismissCleanupReminderAction,
  runMonthlyCleanupAction,
} from "@/app/(app)/(onboarded)/library/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  count: number;
  over: number;
  currentMonthYyyyMm: string;
};

/**
 * Wave 3 monthly cleanup reminder. Surfaces on the first onboarded layout
 * render of a new calendar month when the library is over the 100 cap and
 * the user hasn't dismissed the reminder.
 *
 *  - Cancel = close without running cleanup; will re-show next visit.
 *  - Proceed = run cleanup, optionally dismiss future reminders.
 */
export function CleanupReminderDialog({
  open,
  onOpenChange,
  count,
  over,
  currentMonthYyyyMm,
}: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [pending, startTransition] = useTransition();

  // `over` is consumed for telemetry / future copy variations. The current
  // body uses `count` only, but keeping `over` in the API contract means a
  // future "We'll remove approximately N images" line is a no-prop-change.
  void over;

  function handleProceed() {
    startTransition(async () => {
      if (dontShowAgain) {
        await dismissCleanupReminderAction();
      }
      const result = await runMonthlyCleanupAction(currentMonthYyyyMm);
      if (!result.ok) {
        toast.error("Couldn't run cleanup.");
        onOpenChange(false);
        return;
      }
      if (result.action === "ran" && result.deleted > 0) {
        toast.success(
          `Removed ${result.deleted} unlocked ${result.deleted === 1 ? "image" : "images"}.`,
        );
      } else if (result.action === "ran") {
        toast.info("No unlocked images to remove.");
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Your image library is full
          </DialogTitle>
        </DialogHeader>

        <DialogDescription className="text-base leading-7 text-muted-foreground">
          You have {count} images saved, over the 100-image limit. We&apos;ll
          keep the ones you&apos;ve locked and remove the oldest unlocked
          images to make room. Lock any images you want to keep before
          continuing.
        </DialogDescription>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Checkbox
            checked={dontShowAgain}
            onCheckedChange={(checked) => setDontShowAgain(checked === true)}
            disabled={pending}
          />
          <span className="text-sm text-muted-foreground">
            Don&apos;t show this reminder again
          </span>
        </label>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleProceed} disabled={pending}>
            {pending ? "Cleaning up…" : "Proceed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
