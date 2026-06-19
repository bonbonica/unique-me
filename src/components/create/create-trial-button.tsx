"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TrialUpgradeDialog } from "./trial-upgrade-dialog";

/**
 * Single "Create new posts" button rendered on `/create` for trial-used
 * users. Clicking it opens the {@link TrialUpgradeDialog} instead of
 * triggering generation (trial-used users have no generation capacity left,
 * but per the navigation redesign they see the same Create Posts page as
 * everyone else until they actually try to create something).
 *
 * Server-rendered Create Posts pages decide which surface to render: this
 * button for trial-used users, the {@link GenerateForm} for users who can
 * generate, and `<QuotaGatedScreen />` for the remaining (Pro / Starter /
 * overage / inactive) gate cases.
 */
export function CreateTrialButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="lg"
        onClick={() => setOpen(true)}
        className="rounded-full glow-champagne"
      >
        Create new posts
      </Button>
      <TrialUpgradeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
