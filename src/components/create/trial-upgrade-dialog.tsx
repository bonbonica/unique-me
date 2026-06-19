"use client";

import Link from "next/link";
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
 * Click-time upgrade Dialog shown on `/create` when a trial-used user
 * presses "Create new posts". Replaces the legacy full-page
 * `<TrialGatedScreen />` (Wave 3 task-09): trial-used users now see the
 * same Create Posts page as everyone else, and only see the upgrade
 * prompt when they actually try to create another set of posts.
 *
 * Caller owns the `open` / `onOpenChange` state — keeping the Dialog
 * dumb lets the trigger button decide when to fire it without sharing
 * a React Context.
 */
export function TrialUpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl shadow-float p-8">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-xl font-medium tracking-tight">
            Trial includes one set of posts
          </DialogTitle>
          <DialogDescription className="text-base text-muted-foreground leading-7">
            Upgrade to keep creating posts every week.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button asChild className="rounded-full glow-champagne">
            <Link href="/pricing">Upgrade</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
