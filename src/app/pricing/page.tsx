import { headers } from "next/headers";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import {
  formatMonthlyPrice,
  PLAN_DETAILS,
  type PlanDetails,
} from "@/lib/pricing";
import type { SubscriptionPlan } from "@/lib/schema";
import { subscriptionService } from "@/lib/services";

/**
 * Public `/pricing` page (Phase 3 task-12). Three plan cards — Free trial,
 * Starter, Pro — driven entirely by `PLAN_DETAILS` so the page can never
 * drift from `pricing.ts`. All paid CTAs are inert ("Coming soon"); real
 * upgrade flow lands in Phase 5 with Polar (spec D10).
 *
 * No auth gate — the page renders for signed-out visitors too. We DO read
 * the session opportunistically so the Free-trial CTA can show "Already on
 * trial" (disabled) for users currently in their trial window, per spec
 * § 6.6's table. When there's no session, the Free-trial CTA links to
 * `/register`.
 *
 * Layout follows DESIGN.md § 8.C (card-on-midnight grid): three equal
 * cards, single champagne accent (the Pro card's glow + Recommended pill),
 * generous padding, no exclamation points in microcopy.
 */
export default async function PricingPage() {
  // Opportunistic session read. Failure is non-fatal — if the session
  // lookup throws (e.g. cookie parse issue on a bot crawler), we just
  // treat the visitor as signed-out and render "Start free trial".
  let isOnTrial = false;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session) {
      const snapshot = await subscriptionService.checkSubscription(
        session.user.id
      );
      isOnTrial = snapshot.status === "trial";
    }
  } catch {
    // Swallow — see comment above.
  }

  // Explicit ordering: Free trial → Starter → Pro. The card grid is
  // visually deterministic so it never depends on object-key iteration
  // order from `PLAN_DETAILS`.
  const planOrder: SubscriptionPlan[] = ["free_trial", "starter", "pro"];

  return (
    <div className="container mx-auto px-5 sm:px-8 lg:px-12 py-20 sm:py-28">
      <header className="max-w-2xl mx-auto text-center">
        <h1 className="font-fraunces text-4xl sm:text-5xl tracking-tight font-medium">
          Pick your plan
        </h1>
        <p className="mt-4 text-lg text-muted-foreground leading-8">
          Start free for seven days. Upgrade when you&apos;re ready —
          everything stays in your account.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 mt-16 items-stretch">
        {planOrder.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            details={PLAN_DETAILS[plan]}
            isOnTrial={isOnTrial}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-12">
        Plans are monthly. Annual options launch with payments.
      </p>
    </div>
  );
}

/**
 * Single plan card. Inlined as a private helper to keep the route file
 * self-contained — the card has no reuse site outside `/pricing` in
 * Phase 3, and a dedicated `plan-card.tsx` would just add an import hop.
 *
 * Visual hierarchy:
 *   - Free trial / Starter: neutral `bg-card` + soft shadow.
 *   - Pro: champagne glow + tinted border + "Recommended" pill — the
 *     single champagne accent on the page (DESIGN.md § 3).
 */
function PlanCard({
  plan,
  details,
  isOnTrial,
}: {
  plan: SubscriptionPlan;
  details: PlanDetails;
  isOnTrial: boolean;
}) {
  const isPro = plan === "pro";

  const cardClass = isPro
    ? "bg-card rounded-2xl p-8 shadow-soft border border-primary/30 glow-champagne flex flex-col gap-6 relative"
    : "bg-card rounded-2xl p-8 shadow-soft border border-border flex flex-col gap-6";

  return (
    <div className={cardClass}>
      {isPro ? (
        <span className="self-start inline-flex items-center rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-medium tracking-wider uppercase">
          Recommended
        </span>
      ) : null}

      <h2 className="font-fraunces text-xl font-medium tracking-tight">
        {details.label}
      </h2>

      <PriceBlock plan={plan} />

      <p className="text-sm text-muted-foreground leading-7">
        {details.pitch}
      </p>

      <ul className="space-y-2 flex-1">
        {details.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm">
            <Check className="size-4 text-primary shrink-0 mt-0.5" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <PlanCta plan={plan} isOnTrial={isOnTrial} />
    </div>
  );
}

/**
 * Price block. Free trial renders "Free" + "7 days"; paid plans split
 * `formatMonthlyPrice(plan)` on the "/mo" suffix so the dollar amount
 * stays in `font-fraunces text-4xl` and the cadence in muted body type,
 * sharing a baseline. Prices come exclusively from `pricing.ts` — never
 * hardcoded here.
 */
function PriceBlock({ plan }: { plan: SubscriptionPlan }) {
  if (plan === "free_trial") {
    return (
      <div>
        <div className="font-fraunces text-4xl font-medium tracking-tight">
          Free
        </div>
        <div className="text-sm text-muted-foreground mt-1">7 days</div>
      </div>
    );
  }

  const formatted = formatMonthlyPrice(plan); // e.g. "$9.99/mo"
  const [amount, cadence] = formatted.split("/");

  return (
    <div className="flex items-baseline gap-1">
      <span className="font-fraunces text-4xl font-medium tracking-tight">
        {amount}
      </span>
      <span className="text-base text-muted-foreground">/{cadence}</span>
    </div>
  );
}

/**
 * CTA block. Free-trial behaviour depends on session:
 *   - Signed-out OR signed-in non-trial → "Start free trial" → `/register`.
 *   - Signed-in trial user → disabled "Already on trial" pill.
 *
 * Starter and Pro CTAs are always inert disabled buttons with a
 * `title="Payments arrive in Phase 5"` tooltip per task-12 step 5.
 * We deliberately render `<Button disabled>` directly — no `<Link>`
 * wrapper — so there's no accidental nav target.
 */
function PlanCta({
  plan,
  isOnTrial,
}: {
  plan: SubscriptionPlan;
  isOnTrial: boolean;
}) {
  if (plan === "free_trial") {
    if (isOnTrial) {
      return (
        <Button
          disabled
          size="lg"
          variant="secondary"
          className="w-full rounded-full"
        >
          Already on trial
        </Button>
      );
    }
    return (
      <Button asChild size="lg" className="w-full rounded-full">
        <Link href="/register">Start free trial</Link>
      </Button>
    );
  }

  return (
    <Button
      disabled
      size="lg"
      variant={plan === "pro" ? "default" : "secondary"}
      className="w-full rounded-full"
      title="Payments arrive in Phase 5"
    >
      Coming soon
    </Button>
  );
}
