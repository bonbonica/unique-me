import { QuotaCountdownPill } from "@/components/dashboard/quota-countdown-pill";
import { TrialStrip } from "@/components/dashboard/trial-strip";
import { PLAN_LABELS } from "@/lib/pricing";
import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";

/**
 * Topbar that sits below the global SiteHeader and to the right of the
 * sidebar. Server component — receives the resolved subscription snapshot
 * (and, for Trial users, the boolean `hasAnyBatch` derived from
 * `postService.hasAnyBatch`) from the surrounding layout so we never re-query
 * the DB at render time.
 *
 * The `hasAnyBatch` prop is the canonical signal for Trial's "used"
 * state per Scheduled redesign D-S12: ANY batch in ANY status (including
 * `cancelled`) flips the Trial pill from `"Trial · 1 batch"` →
 * `"Trial used · Upgrade"`. This matches the trial-lifetime-1-batch cap
 * enforced in `subscriptionService.canGenerate` and stays cheap (`select id
 * limit 1` per page render).
 *
 * Hidden on mobile (`md:flex`): the mobile hamburger bar already occupies
 * the topmost row of the viewport on small screens.
 */
export function DashboardTopBar({
  subscription,
  hasAnyBatch,
  scheduledBatchCount,
}: {
  subscription: SubscriptionStateSnapshot;
  /**
   * True if the user has ever generated a batch in any status. Only consulted
   * for Trial users — paid plans use rolling-window counters from the
   * snapshot instead. Pre-computed in the layout so this component stays a
   * pure render of its props.
   */
  hasAnyBatch: boolean;
  /**
   * Stage-2 D-S2-10: count of `weekly_batches.status IN ('scheduling',
   * 'completed')` for the user. Only consulted for the Pro branch's pill —
   * Trial/Starter ignore it. Pre-computed in the layout (mirrors the
   * `hasAnyBatch` pattern: gated DB hit by plan) so this component stays a
   * pure render of its props. Sourced from `postService.getScheduledViewForUser`,
   * which task-02 extended to expose this field.
   */
  scheduledBatchCount: number;
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
        The TrialStrip is a styled pill (champagne badge + Sparkles icon)
        showing days-remaining in the trial, and is separate from the
        quota-status pill below.
      */}
      {subscription.status === "trial" &&
      subscription.daysLeftInTrial !== null ? (
        <TrialStrip daysLeft={subscription.daysLeftInTrial} />
      ) : null}

      {/*
        Status pill — three-variant union, branches on plan:
         - Trial (any status, including expired/cancelled Trial rows) →
           variant="trial". `used` is true iff any batch exists in any
           status (Scheduled redesign D-S12). Renders alongside the
           TrialStrip while the trial is still active; remains as the only
           pill once `daysLeftInTrial === null`.
         - Active Starter → variant="starter". `batchesRemaining` is derived
           from `nextResetAt`: `null` means "no prior batch in window" (under
           cap, 1 left); a future date means "at cap" (0 left). This matches
           `subscriptionService.nextResetAt`'s `no_batch_yet` contract for
           Starter — no rolling-7-day query is duplicated here.
         - Active Pro → variant="pro". Stage-2 D-S2-10 re-anchors
           `batchesRemaining` on `scheduledBatchCount` (count of
           `weekly_batches.status IN ('scheduling','completed')`) rather than
           the Phase-4 `proQuota.used` (batchesUsedThisPeriod) basis —
           cancelled and reviewing batches on `/create` no longer deduct.
           `periodEndsAt` still comes from `proQuota` (Phase 4 D-A19) and
           drives the at-cap countdown.
         - Inactive paid plans (cancelled / expired Starter or Pro) render
           only the plan pill itself — no status pill to show.
      */}
      {subscription.plan === "free_trial" ? (
        <QuotaCountdownPill variant="trial" used={hasAnyBatch} />
      ) : subscription.status === "active" &&
        subscription.plan === "starter" ? (
        <QuotaCountdownPill
          variant="starter"
          batchesRemaining={subscription.nextResetAt === null ? 1 : 0}
          nextResetAt={subscription.nextResetAt}
        />
      ) : subscription.status === "active" &&
        subscription.plan === "pro" &&
        subscription.proQuota !== null ? (
        <QuotaCountdownPill
          variant="pro"
          batchesRemaining={Math.max(0, 4 - scheduledBatchCount)}
          periodEndsAt={subscription.proQuota.periodEndsAt}
        />
      ) : null}
    </div>
  );
}
