import { QuotaCountdownPill } from "@/components/dashboard/quota-countdown-pill";
import { TrialStrip } from "@/components/dashboard/trial-strip";
import { PLAN_LABELS } from "@/lib/pricing";
import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";

/**
 * Topbar that sits below the global SiteHeader and to the right of the
 * sidebar. Server component — receives the resolved subscription snapshot
 * from the surrounding layout so we never re-query the DB at render time.
 *
 * Hidden on mobile (`md:flex`): the mobile hamburger bar already occupies
 * the topmost row of the viewport on small screens.
 */
export function DashboardTopBar({
  subscription,
}: {
  subscription: SubscriptionStateSnapshot;
}) {
  const planLabel = PLAN_LABELS[subscription.plan];

  return (
    <div className="hidden md:flex items-center justify-end gap-4 px-8 lg:px-12 py-4 border-b border-border">
      <span
        className="bg-primary/15 text-primary border border-primary/30 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider"
        aria-label={`Current plan: ${planLabel}`}
      >
        {planLabel}
      </span>

      {/*
        Trial countdown only shows when the user is actively on the trial.
        Paid/expired states already convey their meaning via the plan pill.
        The TrialStrip is a styled pill (champagne badge + Sparkles icon) per
        Phase 2 spec § 8.3, replacing the plain "X days left" text used in
        Phase 1.
      */}
      {subscription.status === "trial" &&
      subscription.daysLeftInTrial !== null ? (
        <TrialStrip daysLeft={subscription.daysLeftInTrial} />
      ) : null}

      {/*
        Paid countdown pill. Mutually exclusive with the trial strip above:
        `status === "trial"` and `status === "active"` can't both be true, so
        at most one of these two pills ever renders. Pro takes precedence
        over Starter because an active Pro row always carries a non-null
        `proQuota` (task-06 D-A19), and Pro's pill copy ("{N} batches left" /
        "Resets in Nd") is the canonical surface for the rolling-30-day cap.

        Starter falls through to the Phase 3 weekly-cap rendering — gated on
        `nextResetAt !== null` to skip paid Starter users with no prior batch
        (under-cap reports `{ at: null, reason: "no_batch_yet" }`). Trial and
        cancelled/expired plans render only the plan pill itself.
      */}
      {subscription.status === "active" &&
      subscription.plan === "pro" &&
      subscription.proQuota !== null ? (
        <QuotaCountdownPill
          variant="pro"
          batchesRemaining={
            subscription.proQuota.max - subscription.proQuota.used
          }
          periodEndsAt={subscription.proQuota.periodEndsAt}
        />
      ) : subscription.status === "active" &&
        subscription.plan === "starter" &&
        subscription.nextResetAt !== null ? (
        <QuotaCountdownPill
          variant="starter"
          nextResetAt={subscription.nextResetAt}
        />
      ) : null}
    </div>
  );
}
