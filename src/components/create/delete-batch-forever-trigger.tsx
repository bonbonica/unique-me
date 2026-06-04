"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DeleteBatchForeverDialog } from "./delete-batch-forever-dialog";

type Props = {
  batchId: string;
  imageCount: number;
};

/**
 * Client wrapper that owns the open-state for `<DeleteBatchForeverDialog />`
 * and renders the secondary destructive trigger Button alongside the primary
 * `Open to reschedule →` CTA on a cancelled `<UnscheduledBatchCard />`.
 *
 * Lives in its own file (rather than co-located in `unscheduled-batch-card.tsx`)
 * so the card itself stays a server component — colocating the `"use client"`
 * boundary in the same file would force the whole card client-side and lose
 * the server-render benefit.
 *
 * Per DESIGN.md §9 there is no `destructive-ghost` button variant — we
 * compose `variant="ghost"` + `text-destructive hover:bg-destructive/10`
 * (mirrors the DropdownMenu destructive-item pattern). The destructive
 * action sits to the LEFT of the primary champagne CTA so the primary
 * action retains right-edge prominence per DESIGN.md §1 (single primary
 * CTA per surface) and §9.
 */
export function DeleteBatchForeverTrigger({ batchId, imageCount }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-destructive hover:bg-destructive/10"
      >
        Delete forever
      </Button>
      <DeleteBatchForeverDialog
        batchId={batchId}
        imageCount={imageCount}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
