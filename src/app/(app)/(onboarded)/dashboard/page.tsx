import { headers } from "next/headers";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { subscriptionService } from "@/lib/services";
import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";

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
  const stats = buildStats(subscription);

  const firstName = session.user.name?.trim().split(/\s+/)[0] ?? null;
  const welcomeHeading = firstName
    ? `Welcome back, ${firstName}.`
    : "Welcome back.";

  return (
    <div className="max-w-5xl">
      <header className="space-y-3">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {welcomeHeading}
        </h1>
        <p className="text-lg text-muted-foreground leading-8">
          Pick up where you left off.
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
