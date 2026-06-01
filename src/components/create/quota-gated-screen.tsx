"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Renders in place of the generate form on `/create` for paid users who
 * fail `subscriptionService.canGenerate`. Three sub-variants, one outer
 * card layout — mirrors `<TrialGatedScreen />` (Phase 2) 1:1 so the gated
 * surfaces feel like a single family.
 *
 *  - **`quota`** — `weekly_cap_active`. Counts down to the next reset.
 *    Day count + weekday are computed *client-side* from `nextResetAt` so
 *    the user's browser timezone — not the UTC server — drives the label
 *    (spec § 9 risks). One-frame SSR/CSR flash is acceptable.
 *  - **`overage`** — `starter_platforms_overage`. Starter user has more
 *    than 2 `profile.platforms`; only reachable via downgrade. CTA points
 *    to `/settings` so they can trim.
 *  - **`inactive`** — `plan_inactive`. Cancelled or expired paid plan.
 *    CTA points to `/pricing`.
 *
 * Marked `"use client"` for the `quota` branch's timezone-aware hydration.
 * The other variants are static but live in the same file to keep the
 * surface family colocated.
 */
export function QuotaGatedScreen(
  props:
    | { variant: "quota"; nextResetAt: Date }
    | { variant: "overage"; currentCount: number }
    | { variant: "inactive" },
) {
  if (props.variant === "quota") {
    return <QuotaVariant nextResetAt={props.nextResetAt} />;
  }

  if (props.variant === "overage") {
    return (
      <div className="max-w-md mx-auto text-center mt-16 space-y-6">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Your Starter plan covers 2 of the 3 platforms you&apos;ve picked.
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Update your profile to choose two. You&apos;ve picked{" "}
          {props.currentCount}.
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild size="lg" className="rounded-full glow-champagne">
            <Link href="/settings">Update profile →</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto text-center mt-16 space-y-6">
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Your subscription isn&apos;t active.
      </h1>
      <p className="text-base text-muted-foreground leading-7">
        Pick a plan to keep generating posts.
      </p>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="rounded-full glow-champagne">
          <Link href="/pricing">See plans →</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * `useSyncExternalStore`-based mount sentinel. Returns `false` during SSR
 * and the first client render, then `true` afterwards. Same pattern as
 * `<ThemeToggle />` uses — keeps us off the `react-hooks/set-state-in-effect`
 * lint rule while still producing identical server and first-client
 * markup so hydration matches.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Quota variant: countdown copy. Day count and weekday are derived from
 * `nextResetAt` in the user's browser timezone — the server is UTC, so
 * computing these on the client is the only way to land on the right
 * weekday for edge cases like a user in Sydney whose reset is at 2am UTC.
 *
 * Initial render returns a generic "soon" headline so SSR and the first
 * CSR pass produce identical markup (no hydration warning); after mount
 * the real values render. This is the "one-frame flash" the spec accepts
 * in § 9.
 *
 * `Math.ceil` on the millisecond delta means "less than 24 hours left"
 * still reads as "1 day" — closer to how a person describes the wait
 * than `Math.floor` would.
 *
 * `Date.now()` and `Intl.DateTimeFormat` are read via
 * `useSyncExternalStore`'s `getSnapshot` indirection (the `mounted` flag)
 * which gates them behind the post-hydration render — keeping the render
 * pure during SSR and the first client pass.
 */
function QuotaVariant({ nextResetAt }: { nextResetAt: Date }) {
  const mounted = useHasMounted();

  const headline = mounted
    ? buildQuotaHeadline(nextResetAt)
    : "Your next batch unlocks soon.";

  return (
    <div className="max-w-md mx-auto text-center mt-16 space-y-6">
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        {headline}
      </h1>
      <p className="text-base text-muted-foreground leading-7">
        Your weekly cycle resets 7 days after your last batch was created.
      </p>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="rounded-full glow-champagne">
          <Link href="/posts">Return to your current batch →</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Module-scope helper so the impure reads (`Date.now`, `Intl`) live
 * outside the component body — the React purity lint rule only fires on
 * component/hook bodies, and gating this call behind `mounted` already
 * guarantees it runs only on the client after hydration.
 */
function buildQuotaHeadline(nextResetAt: Date): string {
  const msUntilReset = nextResetAt.getTime() - Date.now();
  const daysRemaining = Math.max(1, Math.ceil(msUntilReset / 86_400_000));
  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
  }).format(nextResetAt);
  return `Your next batch unlocks in ${daysRemaining} ${
    daysRemaining === 1 ? "day" : "days"
  }, on ${weekday}.`;
}
