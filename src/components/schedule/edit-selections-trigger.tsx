"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reopenBatchAction } from "@/app/(app)/(onboarded)/posting-soon/actions";
import { Button } from "@/components/ui/button";

/**
 * "Edit selections" affordance on `/posting-soon/[batchId]`. Flips the
 * batch back to `reviewing` via {@link reopenBatchAction} and routes the
 * user to the wizard at `/schedule-posts/[batchId]`, where they can add,
 * remove, or otherwise change their per-network selections and re-commit.
 *
 * Pairs with {@link CancelBatchTrigger} in the BatchDetailView footer —
 * cancel is the destructive escape hatch; edit is the non-destructive
 * adjustment path. Server-side ownership + status guards live inside
 * `postService.reopenForEditing`; this trigger only handles the click
 * transition and toast surface.
 */
export function EditSelectionsTrigger({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await reopenBatchAction(batchId);
      if (!result.ok) {
        toast.error(
          result.error === "not_scheduling"
            ? "This batch can't be edited right now."
            : "Couldn't reopen this batch.",
        );
        return;
      }
      router.push(`/schedule-posts/${batchId}`);
    });
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={pending}>
      {pending ? "Opening…" : "Edit selections"}
    </Button>
  );
}
