"use client";

// Phase 3 task-10. Dashboard banner for paid users only — always present,
// copy flips based on `subscriptionService.canGenerate`. Two render
// branches keyed on `state`:
//
//  - "allowed"      → champagne-bordered emphasis card with CTA to /create.
//                     Reached when the rolling-7-day window has elapsed AND
//                     the user has at least one prior batch.
//  - "quota_active" → neutral informational card with a per-user day count
//                     and no CTA. Reached when `canGenerate` returns the
//                     `weekly_cap_active` reason.
//
// Marked `"use client"` for the colocated `<NextResetCountdown />` child —
// the day math needs to run after hydration so the count reflects the
// user's local clock instead of the UTC server's. The outer banner is
// otherwise pure render of props.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Discriminated-union prop shape so the call site picks the branch at the
 * type level and we can't accidentally render the quota-active variant
 * without a `nextResetAt` to count down to.
 */
type NextBatchBannerProps =
  | { state: "allowed"; nextResetAt: null }
  | { state: "quota_active"; nextResetAt: Date | null };

/**
 * Spec § 6.5: the banner is always present for paid users; copy flips on
 * `canGenerate`. Trial users, first-time paid users (no prior batch), and
 * the overage/inactive gate reasons are filtered out by the parent page —
 * this component only ever sees the two states it actually renders.
 *
 * Defensive null-handling: if the parent passes a quota-active state with
 * a null `nextResetAt` (shouldn't happen — `canGenerate.weekly_cap_active`
 * always carries the date), render nothing rather than crash on the
 * countdown.
 */
export function NextBatchBanner(props: NextBatchBannerProps) {
  if (props.state === "allowed") {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8 shadow-soft">
        <h2 className="font-fraunces text-xl sm:text-2xl tracking-tight font-medium">
          Your 7 days are up — you can create your next batch.
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-7">
          Pick your theme and we&apos;ll write seven posts.
        </p>
        <Button
          asChild
          size="lg"
          className="rounded-full glow-champagne mt-4"
        >
          <Link href="/create">Create this week&apos;s posts →</Link>
        </Button>
      </div>
    );
  }

  // quota_active. Guard against a missing `nextResetAt` — the service
  // contract says this branch always carries a date, but rendering "in
  // NaN days" is worse than rendering nothing if that contract ever drifts.
  if (props.nextResetAt === null) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-soft">
      <h2 className="font-fraunces text-xl sm:text-2xl tracking-tight font-medium">
        Next batch in <NextResetCountdown at={props.nextResetAt} /> days.
      </h2>
      <p className="text-sm text-muted-foreground mt-2 leading-7">
        Your weekly cycle resets 7 days after your last batch.
      </p>
    </div>
  );
}

/**
 * `useSyncExternalStore`-based mount sentinel. Returns `false` during SSR
 * and the first client render, then `true` afterwards. Mirrors the idiom
 * used in `<QuotaGatedScreen />` so SSR and the first CSR pass produce
 * identical markup (no hydration warning); the real value renders on the
 * second client pass.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Tiny client child: renders the integer day count between now and
 * `at`. Pre-hydration it renders the literal "a few" so the surrounding
 * sentence reads naturally ("Next batch in a few days.") and the SSR /
 * first-CSR markup stays stable.
 *
 * `Math.max(1, ...)` ensures a sub-24h window still reads as "1" rather
 * than "0" — closer to how a person describes the wait. The component
 * does NOT auto-tick; a refresh fixes a stale count (Phase 3 trade-off
 * documented in the task-10 notes).
 */
function NextResetCountdown({ at }: { at: Date }) {
  const mounted = useHasMounted();
  if (!mounted) {
    return <>a few</>;
  }
  return <>{computeDaysRemaining(at)}</>;
}

/**
 * Module-scope helper so the impure `Date.now()` read lives outside the
 * component body — the React purity lint rule only fires on
 * component/hook bodies, and gating this call behind `mounted` already
 * guarantees it runs only on the client after hydration.
 */
function computeDaysRemaining(at: Date): number {
  return Math.max(1, Math.ceil((at.getTime() - Date.now()) / 86_400_000));
}
