import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { LockedSummary } from "@/components/posts/locked-summary";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { ROLLING_PERIOD_DAYS } from "@/lib/pricing";
import { postService, subscriptionService } from "@/lib/services";

/**
 * `/posts/currently-posting` — server route that resolves the batch whose
 * posting window is currently active and **renders the locked-summary view
 * inline at this URL** so the sidebar's "Currently Posting" nav item
 * highlights via the standard prefix-match `isActive` logic.
 *
 * **Why inline rendering, not a redirect to `/posts?batchId=X`?**
 * If we redirected, the final URL would be `/posts?...` and the sidebar
 * matcher (pathname === href || pathname.startsWith(href + "/")) would
 * fail to highlight the new "Currently Posting" item. Rendering at this
 * URL keeps the pathname stable so both entry paths — clicking the sidebar
 * item AND clicking the `<CurrentlyPostingCta />` button on `/create` —
 * end on the same URL and produce the same highlight.
 *
 * Uses the same `postService.getCurrentlyPostingBatch(userId, periodStart)`
 * helper the CTA on `/create` uses, so the two entry paths always land on
 * the SAME batch. Resolver semantics:
 *
 *   - **Pro** (period start passed): batch where `batchOrdinalInPeriod`
 *     matches the current period week (1..MAX_BATCHES_PER_PERIOD,
 *     status-agnostic). When no batch fills that slot yet, falls back to
 *     the user's oldest `scheduling | completed` batch.
 *   - **Starter / Trial** (no period start): oldest `scheduling |
 *     completed` batch — in practice the user's single active batch.
 *
 * **Status gate.** `<LockedSummary />` only renders correctly for
 * `scheduling` status (its "Currently posting this week …" header is the
 * scheduling-state copy; cancelled / reviewing don't fit the "currently
 * posting" framing). When the resolved batch's status isn't `scheduling`,
 * we render the empty state rather than show the wrong view.
 *
 * Empty state fires when (a) the helper returns null, (b) the resolved
 * batch isn't in `scheduling` status, or (c) `getBatchForReview` fails to
 * hydrate the batch (defensive). The CTA points back to `/create` so the
 * user has an obvious next step.
 *
 * `periodStart` reconstructed from `subscription.proQuota.periodEndsAt -
 * ROLLING_PERIOD_DAYS` per the reconstruction explicitly endorsed in
 * subscription-service.ts:72.
 */
export default async function CurrentlyPostingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const subscription = await subscriptionService.checkSubscription(
    session.user.id,
  );

  const PERIOD_MS = ROLLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  const proPeriodStart =
    subscription.plan === "pro" && subscription.proQuota
      ? new Date(subscription.proQuota.periodEndsAt.getTime() - PERIOD_MS)
      : undefined;

  const batch = await postService.getCurrentlyPostingBatch(
    session.user.id,
    proPeriodStart,
  );

  if (batch && batch.status === "scheduling") {
    const data = await postService.getBatchForReview(
      batch.id,
      session.user.id,
    );
    if (data) {
      return <LockedSummary data={data} />;
    }
  }

  // Empty state — no scheduling batch matches the current period week (or
  // no scheduling batch exists at all). Copy is intentionally calm (no
  // error framing) and points back to the generative path. DESIGN.md §8
  // pattern D (focal-task screen): narrow column, centered, generous
  // breathing room. All tokens from --primary / --foreground /
  // --muted-foreground — no hardcoded colors.
  return (
    <div className="max-w-2xl mx-auto text-center mt-16 space-y-6">
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Nothing is posting right now.
      </h1>
      <p className="text-base text-muted-foreground leading-7">
        When you schedule a batch, it will appear here as it goes live on
        your social media.
      </p>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="rounded-full glow-champagne">
          <Link href="/create">
            Go to Create Posts
            <ArrowRight
              className="ml-1 size-4"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </Link>
        </Button>
      </div>
    </div>
  );
}
