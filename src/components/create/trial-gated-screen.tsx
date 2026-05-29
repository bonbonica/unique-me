import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Renders in place of the generate form on `/create` when the user is on
 * the 7-day trial AND already has a batch in any status (D20). Two
 * distinct surfaces depending on what status that batch is in:
 *
 * - **Cancelled-recoverable** (`batchStatus === "cancelled"`):
 *   Softer copy + primary "Return to my batch" CTA. The user's one
 *   trial batch is still editable and re-schedulable for the rest of
 *   the trial window (cancelled-recoverable flow, partial Item 6 from
 *   the post-Wave-5 brief). "See plans" stays visible as a low-emphasis
 *   secondary link for users who want to upgrade for a second batch.
 *
 * - **Other states** (reviewing / scheduling / scheduled / completed):
 *   Original gated copy — trial batch is in flight or done; no further
 *   batches without an upgrade.
 *
 * `existingBatchId` may be null when {@link postService.getMostRecentBatch}
 * returns nothing surprising — defensive only, the page only renders this
 * component when `hasAnyBatch` is true.
 */
export function TrialGatedScreen({
  existingBatchId,
  batchStatus,
}: {
  existingBatchId: string | null;
  batchStatus: string | null;
}) {
  const isCancelled = batchStatus === "cancelled";

  if (isCancelled) {
    return (
      <div className="max-w-md mx-auto text-center mt-16 space-y-6">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Pick up where you left off
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Your trial batch is still yours to edit and re-schedule. Keep
          working on it during your trial — Pro unlocks a fresh batch.
        </p>
        <div className="flex flex-col gap-3 items-center">
          {existingBatchId ? (
            <Button
              asChild
              size="lg"
              className="rounded-full glow-champagne"
            >
              <Link href={`/posts?batchId=${existingBatchId}`}>
                Return to my batch
              </Link>
            </Button>
          ) : null}
          <Link
            href="/pricing"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            See plans →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center mt-16 space-y-6">
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        You&apos;ve used your trial batch
      </h1>
      <p className="text-base text-muted-foreground leading-7">
        Your 7-day Pro trial includes one batch of 7 posts. Upgrade to keep
        creating.
      </p>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="rounded-full glow-champagne">
          <Link href="/pricing">See plans</Link>
        </Button>
        {existingBatchId ? (
          <Button asChild variant="ghost">
            <Link href={`/posts?batchId=${existingBatchId}`}>
              Review the batch you made →
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
