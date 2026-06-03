"use client";

import { useSyncExternalStore } from "react";

/**
 * Small status pill shown next to the plan pill in {@link DashboardTopBar}
 * for paid users. The contents are plan-aware:
 *
 *  - Starter (rolling 7-day cap, weekly_cap_active) → "Next batch · {N}d".
 *  - Pro under-cap (Phase 4 D-A14) → "{N} batches left". Static — no Date
 *    math — so it never flashes during hydration.
 *  - Pro at-cap (Phase 4 D-A12 / monthly_cap_active) → "Resets in {N}d",
 *    where N counts down to the rolling-30-day period end.
 *
 * Visual intent:
 *  - Muted, not champagne. The plan pill is the focal accent on the TopBar;
 *    this pill is a passive status indicator and shouldn't compete (task-11
 *    notes).
 *  - No leading icon. The TrialStrip pairs Sparkles + champagne tint to
 *    signal "you're trialling Pro features"; this pill is just timing.
 *  - Self-hidden below `sm` as a safety net. The parent TopBar is already
 *    `hidden md:flex`, so the breakpoint here only matters if that ever
 *    loosens — mirrors {@link TrialStrip}.
 *
 * Hydration-safe rendering:
 *  - Branches whose label depends on `Date.now()` (Starter, Pro at-cap) use
 *    the `useSyncExternalStore` mount sentinel idiom — pre-mount renders a
 *    placeholder, post-mount swaps in the real days-left. One-frame flash is
 *    acceptable per spec § 9.
 *  - The Pro under-cap branch ("{N} batches left") is deterministic — N is
 *    passed in from the snapshot and involves no client-clock math — so it
 *    renders identically on server and client and skips the sentinel.
 *  - The countdown does NOT auto-tick (matches task-10's dashboard banner) —
 *    a page refresh fixes a stale count. Days don't change fast enough on
 *    this surface to warrant a live interval.
 */
type Props =
  | { variant: "starter"; nextResetAt: Date }
  | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date };

export function QuotaCountdownPill(props: Props) {
  // Pro under-cap: deterministic copy, no Date math, no mount sentinel needed.
  // Resolved first so the hook below isn't conditional on a value we don't
  // need in this branch.
  if (props.variant === "pro" && props.batchesRemaining > 0) {
    return <Pill label={`${props.batchesRemaining} batches left`} />;
  }

  return <CountdownPill {...props} />;
}

/**
 * Day-count branches (Starter `nextResetAt`, Pro at-cap `periodEndsAt`) share
 * the same hydration sentinel: render an inert placeholder on SSR + first CSR
 * pass, swap in the real count after mount. Splitting this out keeps the
 * `useSyncExternalStore` hook out of the under-cap branch above, which is
 * deterministic and doesn't need it.
 */
function CountdownPill(
  props:
    | { variant: "starter"; nextResetAt: Date }
    | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date },
) {
  const mounted = useHasMounted();

  // Pre-mount: render an inert placeholder so SSR and the first CSR pass
  // produce identical markup. Post-mount: swap in the computed days-left.
  // The "0d" case (period ends within the next 24 hours but the gate hasn't
  // flipped yet) is surfaced literally — it's the correct answer to "when's
  // the next slot" and the dashboard banner (task-10) handles the actual
  // "allowed" copy.
  let label: string;
  if (props.variant === "starter") {
    label = mounted
      ? `Next batch · ${computeDaysLeft(props.nextResetAt)}d`
      : "Next batch · soon";
  } else {
    // Pro at-cap (batchesRemaining === 0). The under-cap branch returns
    // earlier in the parent component, so reaching here implies at-cap.
    label = mounted
      ? `Resets in ${computeDaysLeft(props.periodEndsAt)}d`
      : "Resets soon";
  }

  return <Pill label={label} />;
}

/**
 * Shared visual shell so both branches stay byte-for-byte identical to the
 * pre-Phase-4 chrome — only the text inside changes per Phase 4 task-14.
 */
function Pill({ label }: { label: string }) {
  return (
    <div className="hidden sm:flex items-center gap-2 rounded-full bg-muted border border-border px-3 py-1 text-xs">
      <span className="text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

/**
 * `useSyncExternalStore`-based mount sentinel. Returns `false` during SSR
 * and the first client render, then `true` afterwards. Same pattern as
 * `<QuotaGatedScreen />` and `<ThemeToggle />` — keeps us off the
 * `react-hooks/set-state-in-effect` lint rule while still producing
 * identical server and first-client markup so hydration matches.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Module-scope helper so the impure `Date.now()` read lives outside the
 * component body — the React purity lint rule only fires on component /
 * hook bodies, and gating this call behind `mounted` already guarantees it
 * runs only on the client after hydration.
 *
 * `Math.ceil` means "less than 24 hours left" still reads as "1d" — closer
 * to how a person describes the wait than `Math.floor`. `Math.max(0, …)`
 * clamps the past-due edge case (countdown target slightly in the past, gate
 * not yet checked on this request) to "0d" instead of a negative number.
 */
function computeDaysLeft(target: Date): number {
  return Math.max(
    0,
    Math.ceil((target.getTime() - Date.now()) / 86_400_000),
  );
}
