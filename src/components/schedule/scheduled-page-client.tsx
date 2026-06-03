"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScheduledView } from "@/lib/services/post-service";
import { CancelBatchDialog } from "./cancel-batch-dialog";
import { PastBatchesList } from "./past-batches-list";
import { ScheduledBatchBox } from "./scheduled-batch-box";

type Props = { view: ScheduledView };

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
 * wrapper renders the boxes, the Past Batches disclosure, and the single
 * `<CancelBatchDialog />` instance whose target is swapped via `cancelTarget`
 * state — one dialog mount for any number of boxes.
 *
 * Empty state collapses both sections into a single CTA when there are zero
 * current and zero past batches.
 */
export function ScheduledPageClient({ view }: Props) {
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  const isEmpty = view.current.length === 0 && view.past.length === 0;

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
      {view.current.length > 0 && (
        <section className="space-y-6" aria-label="Current period batches">
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
      )}

      <section aria-label="Past batches">
        <PastBatchesList rows={view.past} />
      </section>

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
