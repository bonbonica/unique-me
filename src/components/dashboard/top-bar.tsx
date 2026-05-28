import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";
import { TrialStrip } from "@/components/dashboard/trial-strip";

/**
 * Human-readable label per plan value. Kept in one map so future plan
 * additions only require touching one spot.
 */
const PLAN_LABELS: Record<SubscriptionStateSnapshot["plan"], string> = {
  free_trial: "Free trial",
  starter: "Starter",
  pro: "Pro",
};

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
        Phase 1 placeholder: real post-count comes online in Phase 2 once
        weekly_batches + posts services land. Wave 4 verification should
        treat this string as a stub, not a contract.
      */}
      <span className="text-xs text-muted-foreground">
        7 posts ready this week
      </span>
    </div>
  );
}
