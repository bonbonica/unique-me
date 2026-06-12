"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DeleteBatchForeverDialog,
  type DeleteWarning,
} from "./delete-batch-forever-dialog";

type Props = {
  batchId: string;
  imageCount: number;
  warning: DeleteWarning;
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
 * Per DESIGN.md §9 there is no `destructive-ghost` button variant. The trigger
 * is composed as a champagne-outlined sibling to the primary CTA — same
 * `size="sm"` for guaranteed height parity, transparent background so the
 * card surface shows through, and `border-primary/40` mirroring the
 * `secondary` variant's beige hairline (DESIGN.md §9). The red lives in the
 * text + icon only, using the explicit hex values specified in the Fix 1a
 * brief (lighter `#f26b6b` at rest, darker `#dc3030` on hover) — the
 * `text-destructive` token reads too washed-out on the midnight card. The
 * destructive action sits to the LEFT of the primary champagne CTA so the
 * primary action retains right-edge prominence per DESIGN.md §1 (single
 * primary CTA per surface) and §9.
 */
export function DeleteBatchForeverTrigger({
  batchId,
  imageCount,
  warning,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="border border-primary/40 bg-transparent text-[#f26b6b] hover:bg-transparent hover:text-[#dc3030]"
      >
        Delete forever
      </Button>
      <DeleteBatchForeverDialog
        batchId={batchId}
        imageCount={imageCount}
        warning={warning}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
