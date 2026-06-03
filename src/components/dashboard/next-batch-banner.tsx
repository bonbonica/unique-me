"use client";

// Phase 3 task-10 / Phase 4 task-15. Dashboard banner for paid users only —
// always present, copy flips based on plan + `subscriptionService.canGenerate`.
// Render branches keyed on `state` and `plan`:
//
//  - "allowed"                       → champagne-bordered emphasis card with
//                                       CTA to /create. Plan is carried so
//                                       Pro-specific copy can diverge later;
//                                       Phase 4 keeps a single allowed copy.
//  - "quota_active" / Starter        → neutral informational card with a
//                                       per-user day count, no CTA. Reached
//                                       when `canGenerate` returns
//                                       `weekly_cap_active`.
//  - "quota_active" / Pro (Phase 4)  → neutral informational card showing
//                                       "{used} of 4 batches used · Next
//                                       reset in {N} days." No CTA. Reached
//                                       any time a Pro user has used at
//                                       least one batch in the current
//                                       period (both under-cap and at-cap;
//                                       gate-screen handles the hard block
//                                       on /create).
//
// Marked `"use client"` for the colocated `<NextResetCountdown />` /
// `<DaysUntilCount />` children — the day math needs to run after hydration
// so the count reflects the user's local clock instead of the UTC server's.
// The outer banner is otherwise pure render of props.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Discriminated-union prop shape so the call site picks the branch at the
 * type level. The `plan` discriminator on `quota_active` keeps the Starter
 * (Phase 3) and Pro (Phase 4) shapes from being conflatable — Starter needs
 * a `nextResetAt`, Pro needs `used` + `periodEndsAt`, and TypeScript
 * exhaustiveness surfaces a missing branch at any call site.
 *
 * The `allowed` branch carries `plan` too even though Phase 4 renders
 * identical copy for all three: it lets a future tweak (e.g. distinct
 * "Ready when you are" copy for a Pro user whose period just rolled over)
 * land without re-threading props through the dashboard. `"pro_zero_used"`
 * is the Pro-specific allowed sub-state (period start, no batches yet);
 * `"starter"` and `"trial"` mirror Phase 3 behavior.
 */
export type NextBatchBannerProps =
  | { state: "allowed"; plan: "starter" | "trial" | "pro_zero_used" }
  | { state: "quota_active"; plan: "starter"; nextResetAt: Date | null }
  | { state: "quota_active"; plan: "pro"; used: number; periodEndsAt: Date };

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
    // Phase 4: the `plan` discriminator is reserved here for future
    // Pro-specific allowed copy. Phase 4 keeps the Phase 3 wording byte-for-
    // byte across all three sub-states so Starter rendering is unchanged
    // and Pro 0-used (just-rolled-over) reads naturally enough.
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

  // quota_active — branch on plan so Starter (Phase 3) and Pro (Phase 4)
  // copy stay isolated and TypeScript narrows each branch's payload.
  if (props.plan === "pro") {
    // Phase 4 § 6.4: "{used} of 4 batches used · Next reset in {N} days."
    // No CTA in either Pro under-cap or at-cap (banner has no CTA in
    // quota_active, Phase 3 rule preserved). The "{used} of 4 batches used"
    // half is deterministic and renders server-side; the day count goes
    // through the mount sentinel to avoid an SSR/CSR hydration mismatch
    // when the server and the user's local clock disagree about which
    // calendar day it is.
    return (
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-soft">
        <h2 className="font-fraunces text-xl sm:text-2xl tracking-tight font-medium">
          {props.used} of 4 batches used · Next reset in{" "}
          <DaysUntilCount at={props.periodEndsAt} />.
        </h2>
        <p className="text-sm text-muted-foreground mt-2 leading-7">
          Your monthly cycle resets 30 days after your billing period start.
        </p>
      </div>
    );
  }

  // Starter quota_active. Guard against a missing `nextResetAt` — the
  // service contract says this branch always carries a date, but rendering
  // "in NaN days" is worse than rendering nothing if that contract ever
  // drifts.
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

/**
 * Pro variant of {@link NextResetCountdown}. Returns the full "{N} day(s)"
 * phrase so the singular/plural handoff lives in one place (the spec calls
 * for "1 day" vs "2 days" inline). Pre-hydration the phrase is "a few days"
 * — the same wording used in the Starter countdown, kept grammatical
 * inside the surrounding "Next reset in __." sentence.
 */
function DaysUntilCount({ at }: { at: Date }) {
  const mounted = useHasMounted();
  if (!mounted) {
    return <>a few days</>;
  }
  const days = computeDaysRemaining(at);
  return (
    <>
      {days} {days === 1 ? "day" : "days"}
    </>
  );
}
