import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Renders in place of the generate form on `/create` when the user is on
 * the 7-day trial AND already has a batch in any status (D20). The trial
 * includes exactly one batch; cancelling it doesn't reset the cap, so even
 * a cancelled batch lands the user here.
 *
 * No `<TrialNote />` here — `<TrialGatedScreen />` is itself the trial
 * messaging surface, and the persistent TopBar strip already says
 * "you're on trial".
 *
 * `existingBatchId` may be null when the user's only batch is in a status
 * that {@link postService.getCurrentBatch} doesn't surface (e.g. cancelled).
 * In that case we drop the secondary review link — the primary "See plans"
 * CTA is still meaningful on its own.
 */
export function TrialGatedScreen({
  existingBatchId,
}: {
  existingBatchId: string | null;
}) {
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
