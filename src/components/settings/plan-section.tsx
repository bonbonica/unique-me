"use client";

// Phase 3 task-13. The "Plan" section on `/settings` — a read-only card
// summarizing current plan, status, trial countdown (trial users), or
// rolling-7-day next-reset (paid users), plus an inline amber warning when a
// Starter user is in `starter_platforms_overage`.
//
// Marked `"use client"` for the colocated `<NextResetSummary />` child — the
// weekday + day count need to run after hydration so the values reflect the
// user's local clock instead of the UTC server's. Mirrors the same
// whole-file approach used by `<QuotaGatedScreen />` and
// `<NextBatchBanner />` (both also `"use client"`-marked files imported from
// server pages). The outer card is otherwise pure render of props.
//
// Read-only by design (spec § 6.7, D10): no upgrade button, no cancel
// button. Plan management arrives in Phase 5.

import { useSyncExternalStore } from "react";
import {
  formatMonthlyPrice,
  PLAN_LABELS,
} from "@/lib/pricing";
import type {
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/lib/schema";

/**
 * Visible label for the status pill. Distinct from the underlying status
 * union so a future "paused"-style status can re-use one of the labels
 * without leaking the internal name.
 */
const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: "Trial",
  active: "Active",
  cancelled: "Cancelled",
  expired: "Expired",
};

/**
 * The pill itself is a plain `<span>` rather than the shared `<Badge>` —
 * the badge defaults to bold weight + transparent border, which doesn't
 * match the TopBar plan pill that this card visually rhymes with. Two
 * tint families:
 *
 *  - Active and trial subscriptions read as live state → champagne tint,
 *    same as the TopBar plan pill (`bg-primary/15 …`).
 *  - Cancelled and expired subscriptions are dormant → muted neutral so
 *    they read visually quieter than an active row.
 */
function statusPillClass(status: SubscriptionStatus): string {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wider uppercase border";
  if (status === "trial" || status === "active") {
    return `${base} bg-primary/15 text-primary border-primary/30`;
  }
  return `${base} bg-muted text-muted-foreground border-border`;
}

type PlanSectionProps = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  daysLeftInTrial: number | null;
  nextResetAt: Date | null;
  platformOverage: { count: number } | null;
  /**
   * Phase 4 task-16 (D-A19): Pro-only monthly quota snapshot. Non-null only
   * for active Pro plans; mirrors the same shape that
   * `SubscriptionStateSnapshot.proQuota` exposes so the wiring in
   * `settings/page.tsx` is mechanical.
   */
  proQuota: { used: number; max: 4; periodEndsAt: Date } | null;
};

/**
 * The "Plan" card on `/settings`. Composition order matches the spec § 6.7
 * sketch: section label, then a two-column row with plan name + price, then
 * the status pill, then any contextual lines (trial countdown OR next-batch
 * summary), then the inline overage warning if present.
 *
 * The next-batch line only renders for an *active* paid plan with a real
 * `nextResetAt`. Cancelled / expired paid plans have no scheduled batch and
 * deliberately drop the line — the status pill already conveys "no
 * generation is happening".
 */
export function PlanSection({
  plan,
  status,
  daysLeftInTrial,
  nextResetAt,
  platformOverage,
  proQuota,
}: PlanSectionProps) {
  // Trial users see the "Free · 7 days" framing per spec § 6.7; paid users
  // see the monthly price from the single-source pricing constants. The
  // sentinel here is `plan === "free_trial"` — `formatMonthlyPrice` would
  // return "Free" for the same case, but the spec copy adds the explicit
  // "· 7 days" tail that doesn't belong inside the shared formatter.
  const priceLabel =
    plan === "free_trial" ? "Free · 7 days" : formatMonthlyPrice(plan);

  const showTrialCountdown =
    status === "trial" && daysLeftInTrial !== null;

  // "Next batch" only makes sense for an active paid plan with a real reset
  // date. Trial users have no rolling window; cancelled / expired plans
  // aren't scheduled to generate anything.
  //
  // Phase 4 task-16: suppressed for Pro because the new Pro usage line below
  // (`<ProQuotaSummary />`) already surfaces the same reset date alongside
  // batches-used. Showing both for Pro reads redundantly. Starter keeps the
  // original Phase 3 line unchanged.
  const showNextReset =
    status === "active" &&
    plan !== "free_trial" &&
    plan !== "pro" &&
    nextResetAt !== null;

  // Phase 4 task-16: Pro-only "{used} of 4 batches used this period · Resets
  // {date}" line. `proQuota` is non-null only for active Pro plans (per
  // `SubscriptionStateSnapshot` semantics), so the explicit `plan === "pro"`
  // check is belt-and-suspenders against a future caller that wires Starter
  // or trial through this prop.
  const showProQuota = plan === "pro" && proQuota !== null;

  return (
    <section className="bg-card rounded-2xl p-8 shadow-soft border border-border space-y-4">
      <p className="font-fraunces text-xl font-medium tracking-tight">
        Your plan
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-2xl font-medium tracking-tight">
          {PLAN_LABELS[plan]}
        </p>
        <p className="text-2xl font-medium tracking-tight tabular-nums">
          {priceLabel}
        </p>
      </div>

      <div>
        <span className={statusPillClass(status)}>{STATUS_LABEL[status]}</span>
      </div>

      {showTrialCountdown ? (
        <p className="text-sm text-muted-foreground">
          Trial ends in {daysLeftInTrial}{" "}
          {daysLeftInTrial === 1 ? "day" : "days"}.
        </p>
      ) : null}

      {showNextReset ? (
        // `nextResetAt` is non-null here per the `showNextReset` guard.
        // The non-null forwarding sidesteps an extra `!` in the JSX.
        <NextResetSummary at={nextResetAt} />
      ) : null}

      {showProQuota ? (
        // `proQuota` is non-null here per the `showProQuota` guard. Same
        // non-null forwarding idiom as `<NextResetSummary />` above.
        <ProQuotaSummary quota={proQuota} />
      ) : null}

      {platformOverage ? (
        // Amber treatment per DESIGN.md § 3 status colors. Warning, not
        // destructive — this is a soft "fix me" state, not an error.
        // Phase 3 has no platform-editor UI on `/settings` yet, so the
        // copy ends at the instruction without a link target.
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/20 p-3 text-sm text-amber-300">
          Starter covers 2 platforms — you&apos;ve picked{" "}
          {platformOverage.count}. Choose 2 to keep generating.
        </div>
      ) : null}
    </section>
  );
}

/**
 * `useSyncExternalStore`-based mount sentinel. Returns `false` during SSR
 * and the first client render, then `true` afterwards. Mirrors the idiom
 * used in `<QuotaGatedScreen />` and `<NextBatchBanner />` so SSR and the
 * first CSR pass produce identical markup (no hydration warning); the real
 * value renders on the second client pass.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Renders the "Next batch ready {Weekday}, in {N} days." line. Weekday
 * and day count both come from the user's browser timezone — the server
 * is UTC, so deriving these on the client is the only way to land on the
 * right weekday for, e.g., a Sydney user whose UTC-stamped reset crosses
 * local midnight. Pre-hydration falls back to a stable
 * "Next batch ready soon." so SSR and the first CSR pass match.
 */
function NextResetSummary({ at }: { at: Date }) {
  const mounted = useHasMounted();

  if (!mounted) {
    return (
      <p className="text-sm text-muted-foreground">Next batch ready soon.</p>
    );
  }

  const { weekday, days } = buildNextResetParts(at);
  return (
    <p className="text-sm text-muted-foreground">
      Next batch ready {weekday}, in {days} {days === 1 ? "day" : "days"}.
    </p>
  );
}

/**
 * Module-scope helper so the impure `Date.now()` + `Intl` reads live
 * outside the component body — the React purity lint rule only fires on
 * component/hook bodies, and gating this call behind `mounted` already
 * guarantees it runs only on the client after hydration.
 *
 * `Math.max(1, Math.ceil(...))` ensures a sub-24h window still reads as
 * "1 day" rather than "0" — closer to how a person describes the wait,
 * and matches the convention used by `<NextBatchBanner />` and
 * `<QuotaGatedScreen />`.
 */
function buildNextResetParts(at: Date): { weekday: string; days: number } {
  const days = Math.max(1, Math.ceil((at.getTime() - Date.now()) / 86_400_000));
  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
  }).format(at);
  return { weekday, days };
}

/**
 * Phase 4 task-16: renders the Pro-only "{used} of 4 batches used this
 * period · Resets {Weekday, Date}" line. Lives next to
 * `<NextResetSummary />` so the two paid-plan lines share a single visual
 * weight (`text-sm text-muted-foreground leading-7` per DESIGN.md).
 *
 * Same SSR-flash idiom as `<NextResetSummary />`: pre-hydration we render
 * a stable fallback so the first SSR + CSR pass agree, then the real
 * weekday + formatted date appear on the second client pass. This avoids
 * the user's local timezone being computed against the UTC server.
 *
 * Singular/plural intentionally not collapsed — "1 of 4 batch used" reads
 * awkwardly, so the spec (task-16 § Notes) standardises on the plural form
 * across the board.
 */
function ProQuotaSummary({
  quota,
}: {
  quota: { used: number; max: 4; periodEndsAt: Date };
}) {
  const mounted = useHasMounted();

  if (!mounted) {
    return (
      <p className="text-sm text-muted-foreground leading-7">
        {quota.used} of {quota.max} batches used this period.
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground leading-7">
      {quota.used} of {quota.max} batches used this period
      {" · Resets "}
      <ResetDate at={quota.periodEndsAt} />
    </p>
  );
}

/**
 * Phase 4 task-16: client-side "Weekday, Month Day" formatter. Kept inline
 * rather than imported from `<NextBatchBanner />` or `<QuotaGatedScreen />`
 * because those files are being edited in parallel waves; sharing a
 * helper would create a cross-task ordering hazard. If/when a shared
 * date-format module lands, this can collapse into a single import.
 *
 * Uses the browser's locale via `Intl.DateTimeFormat(undefined, …)` so a
 * user in Sydney sees their local weekday, not the UTC weekday the server
 * would have computed.
 */
function ResetDate({ at }: { at: Date }) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(at);
  return <>{formatted}</>;
}
