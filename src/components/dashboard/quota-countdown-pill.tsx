"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

/**
 * Small status pill shown next to the plan pill in {@link DashboardTopBar}.
 * Three-variant discriminated union covers every plan:
 *
 *  - **Trial** (Scheduled redesign D-S12) — honest, non-resetting copy.
 *    `used: false` → `"Trial · 1 batch"`. `used: true` → `"Trial used ·
 *    Upgrade"`, the whole pill wrapped in `<Link href="/pricing">` so the
 *    topbar surfaces a single confident upgrade nudge. Trial has no rolling
 *    window — both labels are static, no client-clock math needed.
 *  - **Starter** (Phase 3 weekly_cap_active + Scheduled redesign D-S11) —
 *    `batchesRemaining > 0` → `"1 batch left"` (deterministic, no sentinel).
 *    `batchesRemaining === 0` → `"Resets in {N}d"` via the at-cap countdown.
 *    Starter's cap is 1 batch per rolling 7-day window, so under-cap is
 *    always exactly one batch.
 *  - **Pro** (Phase 4 D-A12 / D-A14 + Scheduled redesign D-S11 + Stage-2
 *    D-S2-10) — `batchesRemaining > 0` → `"{N} batches left"` (singular `"1
 *    batch left"` when N=1, deterministic, no sentinel). `batchesRemaining
 *    === 0` → `"Resets in {N}d"` against the rolling 30-day period end.
 *    As of Stage-2, `batchesRemaining = 4 - scheduledBatchCount` where
 *    `scheduledBatchCount` counts only `weekly_batches.status IN
 *    ('scheduling', 'completed')`. Cancelled and reviewing batches on
 *    `/create` no longer deduct.
 *
 * Visual intent:
 *  - Muted, not champagne. The plan pill is the focal accent on the TopBar;
 *    this pill is a passive status indicator and shouldn't compete.
 *  - No leading icon. The TrialStrip pairs Sparkles + champagne tint to
 *    signal "you're trialling Pro features"; this pill is just timing.
 *  - Self-hidden below `sm` as a safety net. The parent TopBar is already
 *    `hidden md:flex`, so the breakpoint here only matters if that ever
 *    loosens — mirrors {@link TrialStrip}.
 *  - Trial-used branch wraps the same pill chrome in a `<Link>` — hover /
 *    focus affordance comes from the link, the pill itself stays muted.
 *
 * Hydration-safe rendering:
 *  - Branches whose label depends on `Date.now()` (Starter at-cap, Pro at-cap)
 *    use the `useSyncExternalStore` mount sentinel idiom — pre-mount renders a
 *    placeholder, post-mount swaps in the real days-left. One-frame flash is
 *    acceptable per spec § 9.
 *  - Under-cap branches ("1 batch left", "{N} batches left") are deterministic
 *    — N is passed in from the snapshot and involves no client-clock math —
 *    so they render identically on server and client and skip the sentinel.
 *  - The Trial branches are also static — Trial has no rolling reset to
 *    count down. The `<Link>` wrap renders identically SSR + CSR.
 *  - The countdown does NOT auto-tick (matches the dashboard banner) — a page
 *    refresh fixes a stale count. Days don't change fast enough on this
 *    surface to warrant a live interval.
 *
 * Voice (DESIGN.md § 14): plain verbs, no exclamation, middle-dot `·`
 * separator. `"Upgrade"` is a confident verb in the same family as
 * `"Generate"` / `"Review"` / `"Publish"`.
 */
type Props =
  | { variant: "trial"; used: boolean }
  | { variant: "starter"; batchesRemaining: number; nextResetAt: Date | null }
  | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date };

export function QuotaCountdownPill(props: Props) {
  // Trial: static labels, no sentinel. The `used: true` branch is the single
  // topbar surface that nudges Trial users to upgrade — wrap the pill chrome
  // in a `<Link>` so the whole target is one click + keyboard-focusable.
  if (props.variant === "trial") {
    if (props.used) {
      return (
        <Link
          href="/pricing"
          className="rounded-full no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
        >
          <Pill label="Trial used · Upgrade" />
        </Link>
      );
    }
    return <Pill label="Trial · 1 batch" />;
  }

  // Starter & Pro under-cap: deterministic copy, no Date math, no mount
  // sentinel needed. Singular/plural inflection (`1 batch` vs `N batches`)
  // matches English and matches DESIGN.md voice.
  if (props.batchesRemaining > 0) {
    const noun = props.batchesRemaining === 1 ? "batch" : "batches";
    return <Pill label={`${props.batchesRemaining} ${noun} left`} />;
  }

  // At cap — both Starter and Pro use the same `Resets in Nd` countdown,
  // sharing the same hydration sentinel below. Discriminated union narrowing
  // means TypeScript carries the `variant`-specific date field through.
  return <CountdownPill {...props} />;
}

/**
 * Day-count branch shared by Starter at-cap (`nextResetAt`) and Pro at-cap
 * (`periodEndsAt`). Uses the `useSyncExternalStore` mount sentinel: render an
 * inert placeholder on SSR + first CSR pass, swap in the real count after
 * mount. Splitting this out keeps the hook out of the deterministic branches
 * above, which don't need it.
 *
 * `batchesRemaining` is widened to `number` (not literal `0`) because TS
 * can't narrow `number > 0 ? … : here` into a literal-`0` type. The parent
 * `QuotaCountdownPill` is the authority on routing — by the time we reach
 * this branch the value is `0` by construction. The field is kept on the
 * prop type so callers can pass `{ ...props }` from the parent without
 * filtering it out.
 *
 * Starter under-cap that has never generated a batch passes
 * `nextResetAt: null` per the existing `no_batch_yet` contract — that case
 * falls through to `"Resets soon"`. (In practice this is unreachable: a
 * Starter user with `nextResetAt === null` is under cap, so they'd be routed
 * to the `batchesRemaining > 0` branch above. The fallback is purely
 * defensive.)
 */
function CountdownPill(
  props:
    | { variant: "starter"; batchesRemaining: number; nextResetAt: Date | null }
    | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date },
) {
  const mounted = useHasMounted();

  const target =
    props.variant === "starter" ? props.nextResetAt : props.periodEndsAt;

  if (target === null) {
    // Defensive Starter `no_batch_yet` fallthrough. The deterministic
    // `batchesRemaining > 0` branch above should have caught this case.
    return <Pill label="Resets soon" />;
  }

  // Pre-mount: render an inert placeholder so SSR and the first CSR pass
  // produce identical markup. Post-mount: swap in the computed days-left.
  // The "0d" case (period ends within the next 24 hours but the gate hasn't
  // flipped yet) is surfaced literally — it's the correct answer to "when's
  // the next slot" and the dashboard banner handles the actual "allowed"
  // copy.
  const label = mounted
    ? `Resets in ${computeDaysLeft(target)}d`
    : "Resets soon";

  return <Pill label={label} />;
}

/**
 * Shared visual shell. Pill chrome is unchanged from the pre-Scheduled-
 * redesign chrome — only the text inside changes per D-S11 / D-S12.
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
