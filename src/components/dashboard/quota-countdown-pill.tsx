"use client";

import { useSyncExternalStore } from "react";

/**
 * Small status pill shown next to the plan pill in {@link DashboardTopBar}
 * for paid users currently in the `weekly_cap_active` state. Communicates the
 * days remaining until the rolling-7-day window opens: "Next batch · 3d".
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
 *  - The day count depends on `Date.now()`, which differs between the UTC
 *    server and the user's browser. Computing the count during SSR would
 *    desync from the client's first render and produce a hydration warning.
 *  - We mirror the `useSyncExternalStore` mount-sentinel idiom used in
 *    `<QuotaGatedScreen />`: pre-mount renders a placeholder ("Next batch ·
 *    soon"), post-mount swaps in the real days-left value. One-frame flash
 *    is acceptable per spec § 9.
 *  - The countdown does NOT auto-tick (matches task-10's dashboard banner) —
 *    a page refresh fixes a stale count. Days don't change fast enough on
 *    this surface to warrant a live interval.
 */
export function QuotaCountdownPill({ nextResetAt }: { nextResetAt: Date }) {
  const mounted = useHasMounted();

  // Pre-mount: render an inert placeholder so SSR and the first CSR pass
  // produce identical markup. Post-mount: swap in the computed days-left.
  // The "0d" case (last batch >7d ago but the gate hasn't flipped yet) is
  // surfaced literally — it's the correct answer to "when's the next slot"
  // and the dashboard banner (task-10) handles the actual "allowed" copy.
  const label = mounted
    ? `Next batch · ${computeDaysLeft(nextResetAt)}d`
    : "Next batch · soon";

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
 * clamps the past-due edge case (last batch >7d ago, gate not yet checked
 * on this request) to "0d" instead of a negative number.
 */
function computeDaysLeft(nextResetAt: Date): number {
  return Math.max(
    0,
    Math.ceil((nextResetAt.getTime() - Date.now()) / 86_400_000),
  );
}
