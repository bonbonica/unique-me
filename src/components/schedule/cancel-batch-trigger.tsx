"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CancelBatchDialog } from "./cancel-batch-dialog";

/**
 * Footer `[Cancel batch]` button + dialog state for `/schedule/[batchId]`.
 *
 * Thin client wrapper so `<BatchDetailView />` can stay a server component:
 * owns only the dialog open boolean, delegates the entire confirmation flow
 * to the Stage-1 `<CancelBatchDialog />` (which already calls the existing
 * `cancelBatchAction` and handles `revalidatePath('/schedule')` +
 * `revalidatePath('/create')`).
 *
 * Stage-1 dormant props `alreadyPostedCount` / `queuedCount` are left at
 * their defaults — Phase-7 will populate them from `posted` rows on the box
 * data and the dialog's split copy will activate automatically.
 */
export function CancelBatchTrigger({
  batchId,
  totalPosts,
}: {
  batchId: string;
  totalPosts: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Cancel batch
        </Button>
      </div>
      <CancelBatchDialog
        batchId={batchId}
        totalPosts={totalPosts}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
