import { headers } from "next/headers";
import Link from "next/link";
import {
  NextBatchBanner,
  type NextBatchBannerProps,
} from "@/components/dashboard/next-batch-banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { postService, subscriptionService } from "@/lib/services";
import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";

/**
 * Banner render decision (spec § 6.5). Returned as the exact
 * {@link NextBatchBannerProps} shape so the dashboard page just spreads it
 * onto `<NextBatchBanner />` — no JSX-branching at the call site, and a
 * missing variant trips the TypeScript exhaustiveness check.
 *
 * `null` means "don't render" — trial users, first-time paid users, and
 * the overage/inactive gate reasons all share that branch.
 */
type BannerDecision = NextBatchBannerProps | null;

/**
 * Spec § 6.5 / Phase 4 § 6.4 visibility rules, in evaluation order:
 *
 *   1. Trial users and the defensive `free_trial` plan check → null.
 *      Trial gets its own surfaces (trial strip, trial-gated screen).
 *   2. Pro user with any in-period usage (`proQuota.used > 0`), regardless
 *      of whether the gate is still open → Pro quota_active banner showing
 *      "{used} of 4 batches used". This intentionally evaluates before the
 *      `gate.allowed` allowed-banner branch so a Pro user mid-period sees
 *      usage instead of the "Your 7 days are up" Starter copy.
 *   3. Otherwise call `canGenerate`:
 *      - `allowed === true` AND has at least one prior batch → allowed
 *        banner with CTA. First-time paid users (allowed + no batch)
 *        land at the empty `/create` form, so the banner stays hidden.
 *      - `weekly_cap_active` → Starter quota-active banner.
 *      - `monthly_cap_active` → Pro quota-active banner. Reached only when
 *        `proQuota` is null (defensive — proQuota is non-null whenever the
 *        Pro branch of canGenerate fires, but we read from gate as the
 *        authoritative source).
 *      - `starter_platforms_overage` or `plan_inactive` → null. Those
 *        reasons surface on `/create` and `/settings` respectively.
 */
async function decideBanner(
  userId: string,
  subscription: SubscriptionStateSnapshot,
): Promise<BannerDecision> {
  if (
    subscription.status === "trial" ||
    subscription.plan === "free_trial"
  ) {
    return null;
  }

  const gate = await subscriptionService.canGenerate(userId);

  // Phase 4 § 6.4: a Pro user with any in-period usage sees the usage
  // banner regardless of whether the gate is still open. `proQuota` is
  // non-null only when `plan === "pro" && status === "active"`, so this
  // branch also implicitly skips inactive/cancelled Pro rows (they fall
  // through to the `gate.allowed` / `plan_inactive` paths below).
  if (
    subscription.plan === "pro" &&
    subscription.proQuota &&
    subscription.proQuota.used > 0
  ) {
    return {
      state: "quota_active",
      plan: "pro",
      used: subscription.proQuota.used,
      periodEndsAt: subscription.proQuota.periodEndsAt,
    };
  }

  if (gate.allowed) {
    // First-time paid users land at the empty /create form, not a
    // dashboard banner — so the banner only appears once they have at
    // least one prior batch to reset the rolling window against.
    const lastBatch = await postService.getMostRecentBatch(userId);
    if (!lastBatch) {
      return null;
    }
    // Pro users with 0 usage fall here too (the proQuota.used > 0 branch
    // above didn't match). They see the same "allowed" copy as Starter
    // for Phase 4; the `pro_zero_used` sub-state lets a future copy
    // tweak land without re-threading props. `free_trial` is unreachable
    // because the trial branch returned early above, but the union
    // covers it with `"trial"` for completeness.
    const allowedPlan: Extract<
      NextBatchBannerProps,
      { state: "allowed" }
    >["plan"] =
      subscription.plan === "pro"
        ? "pro_zero_used"
        : subscription.plan === "starter"
          ? "starter"
          : "trial";
    return { state: "allowed", plan: allowedPlan };
  }

  if (gate.reason === "weekly_cap_active") {
    return {
      state: "quota_active",
      plan: "starter",
      nextResetAt: gate.nextResetAt,
    };
  }

  if (gate.reason === "monthly_cap_active") {
    // Defensive: a Pro user at-cap should have already matched the
    // `proQuota.used > 0` branch above (used === 4). This fallback covers
    // a transient state where `canGenerate` and the snapshot disagree —
    // e.g. proQuota became null between reads. We synthesize a
    // proQuota-shaped payload from the gate reason so the banner still
    // renders the correct copy without re-querying.
    return {
      state: "quota_active",
      plan: "pro",
      used: gate.batchesUsed,
      periodEndsAt: gate.nextResetAt,
    };
  }

  // overage / inactive / trial_batch_exists (unreachable for non-trial)
  // all suppress the banner — they have dedicated surfaces.
  return null;
}

/**
 * Plan-name label used inside helper strings on the dashboard. Mirrors the
 * mapping in {@link DashboardTopBar} but lowercased to read naturally inside
 * a sentence ("On the starter plan." vs "On the Starter plan.").
 */
const PLAN_LABELS_LOWER: Record<SubscriptionStateSnapshot["plan"], string> = {
  free_trial: "free trial",
  starter: "starter",
  pro: "pro",
};

type Stat = {
  label: string;
  value: string;
  helper: string;
};

/**
 * Build the three placeholder stat cards from subscription state. Real
 * batch + connected-account counts arrive in later phases — until then
 * "Posts scheduled this week" and "Connected accounts" are hard-coded to 0.
 */
function buildStats(subscription: SubscriptionStateSnapshot): readonly Stat[] {
  const daysLeftValue =
    subscription.daysLeftInTrial !== null
      ? String(subscription.daysLeftInTrial)
      : "—";

  const trialHelper =
    subscription.status === "trial"
      ? "Your free week is on the house."
      : `On the ${PLAN_LABELS_LOWER[subscription.plan]} plan.`;

  return [
    {
      label: "Posts scheduled this week",
      value: "0",
      helper: "Nothing scheduled yet.",
    },
    {
      label: "Days left in trial",
      value: daysLeftValue,
      helper: trialHelper,
    },
    {
      label: "Connected accounts",
      value: "0",
      helper: "Add your first in Settings.",
    },
  ];
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  // The (onboarded) layout already redirects unauthenticated visitors, so by
  // the time this component renders `session` is non-null. We still guard
  // here to satisfy the type narrower without resorting to a non-null
  // assertion.
  if (!session) {
    return null;
  }

  const subscription = await subscriptionService.checkSubscription(
    session.user.id,
  );
  const banner = await decideBanner(session.user.id, subscription);
  const stats = buildStats(subscription);
  const hasAnyBatch = await postService.hasAnyBatch(session.user.id);

  const firstName = session.user.name?.trim().split(/\s+/)[0] ?? null;
  const welcomeHeading = hasAnyBatch
    ? firstName
      ? `Welcome back, ${firstName}.`
      : "Welcome back."
    : firstName
      ? `Welcome, ${firstName}.`
      : "Welcome.";
  const welcomeSubtext = hasAnyBatch
    ? "Pick up where you left off."
    : "Let's create your first posts.";

  return (
    <div className="max-w-5xl">
      {banner ? (
        <div className="mb-8 sm:mb-12">
          <NextBatchBanner {...banner} />
        </div>
      ) : null}

      <header className="space-y-3">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {welcomeHeading}
        </h1>
        <p className="text-lg text-muted-foreground leading-8">
          {welcomeSubtext}
        </p>
      </header>

      <Card className="rounded-2xl p-8 sm:p-10 bg-card border-border shadow-soft mt-12 flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-10 card-interactive">
        <div className="flex-1 space-y-3">
          <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
            Create this week&apos;s posts
          </h2>
          <p className="text-base text-muted-foreground leading-7 max-w-md">
            Tell us your theme and we&apos;ll write seven posts with images,
            ready to schedule and publish.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="rounded-full glow-champagne self-start sm:self-center shrink-0"
        >
          <Link href="/create">Start this week</Link>
        </Button>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mt-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-card rounded-2xl border border-border p-6 shadow-soft space-y-2"
          >
            <p className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
              {stat.label}
            </p>
            <p className="font-fraunces text-3xl font-medium tracking-tight">
              {stat.value}
            </p>
            <p className="text-sm text-muted-foreground">{stat.helper}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
