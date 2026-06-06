"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScheduledView } from "@/lib/services/post-service";
import { CancelBatchDialog } from "./cancel-batch-dialog";
import { CreateNextBatchCta } from "./create-next-batch-cta";
import { ScheduledBatchBox } from "./scheduled-batch-box";

type Props = {
  view: ScheduledView;
  /**
   * Pro: count of ALL `weekly_batches` rows for the user in the current Pro
   * period (any status, including cancelled) — the same value
   * `canGenerate` evaluates against the 4-per-period cap. Drives the
   * `<CreateNextBatchCta />` label so the CTA and the server gate never
   * disagree. Trial / Starter: 0 (CTA's `/4` semantic is Pro-specific; for
   * non-Pro plans the CTA still renders but never trips the at-cap state).
   */
  proBatchesUsed: number;
};

type CancelTarget = {
  id: string;
  totalPosts: number;
  alreadyPostedCount: number;
  queuedCount: number;
};

/**
 * Client wrapper that owns the cancel-dialog state for the Scheduled page.
 *
 * The page itself stays a server component (data fetching, header). This
 * wrapper renders the boxes and the single `<CancelBatchDialog />` instance
 * whose target is swapped via `cancelTarget` state — one dialog mount for
 * any number of boxes.
 *
 * Empty state collapses into a single CTA when there are zero current
 * batches.
 */
export function ScheduledPageClient({ view, proBatchesUsed }: Props) {
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const isEmpty = view.current.length === 0;

  if (isEmpty) {
    return (
      <section className="space-y-4">
        <p className="text-base text-muted-foreground leading-7">
          You don&apos;t have any scheduled batches yet.
        </p>
        <Button asChild>
          <Link href="/create">
            Start a new batch
            <ArrowRight
              className="ml-1 size-4"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <>
      <div className="space-y-8">
        <CreateNextBatchCta proBatchesUsed={proBatchesUsed} />
        <section
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
          aria-label="Current period batches"
        >
          {view.current.map((batch) => (
            <ScheduledBatchBox
              key={batch.id}
              data={batch}
              onCancelClick={() =>
                setCancelTarget({
                  id: batch.id,
                  totalPosts: batch.totalPosts,
                  alreadyPostedCount: batch.alreadyPostedCount,
                  queuedCount: batch.queuedCount,
                })
              }
            />
          ))}
        </section>
      </div>

      {cancelTarget && (
        <CancelBatchDialog
          batchId={cancelTarget.id}
          totalPosts={cancelTarget.totalPosts}
          alreadyPostedCount={cancelTarget.alreadyPostedCount}
          queuedCount={cancelTarget.queuedCount}
          open={true}
          onOpenChange={(open) => {
            if (!open) setCancelTarget(null);
          }}
        />
      )}
    </>
  );
}
