// Phase 1: subscription-service. Owns the trial lifecycle — start, lookup,
// and active-state derivation. Phase 6 will add Polar billing integration and
// a cron job that flips expired trials to `status: "expired"`; until then
// expiry is computed on read.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { MAX_BATCHES_PER_PERIOD, ROLLING_PERIOD_DAYS } from "@/lib/pricing";
import {
  profiles,
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
  subscriptions,
  weeklyBatches,
} from "@/lib/schema";

/**
 * Trial length in days. Phase 6's cron job will read this same constant when
 * flipping expired trials, so it has to live in one place.
 */
const TRIAL_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Result of {@link checkSubscription}. Compact, derived-on-read snapshot
 * suitable for middleware and UI gating. The raw row is available via
 * {@link getSubscription} when callers need the underlying fields.
 *
 * Phase 4 task-06 (D-A19): `proQuota` is the canonical Pro-at-cap source.
 * It is non-null only when `plan === "pro" && status === "active"`; trial,
 * Starter, and inactive Pro rows return `null`. `proQuota` and
 * {@link SubscriptionStateSnapshot#nextResetAt} carry related information for
 * Pro at-cap users — UI surfaces render whichever is more idiomatic for their
 * context (the TopBar pill prefers the `used / max` count; the dashboard
 * banner prefers the `periodEndsAt` date).
 */
export type SubscriptionStateSnapshot = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  isActive: boolean;
  daysLeftInTrial: number | null;
  /**
   * Phase 3 task-11: paid-only countdown source. `null` for trial users (no
   * rolling window), users with no prior batch, or inactive plans. When a
   * real date is present, callers (TopBar countdown pill, dashboard banner)
   * derive day counts from it without re-querying the DB.
   */
  nextResetAt: Date | null;
  /**
   * Scheduled-page redesign (D-S8): the raw rolling-30-day quota anchor. Always
   * present — the DB column is NOT NULL with a `now()` default, so every
   * subscription row has one. Consumers needing the *current* period window
   * (e.g. `postService.getScheduledViewForUser`) pass this through
   * {@link computeCurrentPeriodStart} together with `now()` to compute
   * `periodStartDate` / `periodEndsAt` for **all plans**, not just Pro. For
   * Pro, the value here equals `proQuota.periodEndsAt - 30d`; surfaced as a
   * top-level field so Trial/Starter readers don't have to special-case the
   * `proQuota === null` branch.
   *
   * The defensive snapshot returned when no subscription row exists uses
   * `new Date()` here — a single safe value the windowing helper can subtract
   * a period from without crashing. Real users always have a real anchor.
   */
  periodStartDate: Date;
  /**
   * Phase 4 D-A19: Pro monthly quota snapshot. Non-null only for active Pro
   * users. `max` is a literal `4` (intentionally duplicating
   * `MAX_BATCHES_PER_PERIOD`) so the type is self-describing — consumers can
   * see the cap without importing the pricing constant. UI derives any
   * additional Pro fields (e.g. `batchesRemaining = max - used`,
   * `currentPeriodStart = periodEndsAt - 30d`) from these two values.
   */
  proQuota: { used: number; max: 4; periodEndsAt: Date } | null;
};

/**
 * Create a free-trial subscription row for a newly-signed-up user. Called
 * from Better Auth's `databaseHooks.user.create.after` (see `auth.ts`).
 *
 * Idempotent via `onConflictDoNothing` on the unique `user_id` index — if a
 * subscription row already exists (e.g. the hook fires twice on a race, or
 * the user signs up again after deletion), we keep the existing row and
 * return it.
 */
export async function startTrial(userId: string): Promise<Subscription> {
  const now = new Date();
  const trialEndDate = new Date(now.getTime() + TRIAL_DAYS * MS_PER_DAY);

  const inserted = await db
    .insert(subscriptions)
    .values({
      userId,
      plan: "free_trial",
      status: "trial",
      trialStartDate: now,
      trialEndDate,
      billingCycle: null,
      postsUsedThisMonth: 0,
      regenerationsDuringTrial: 0,
    })
    .onConflictDoNothing({ target: subscriptions.userId })
    .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  // Insert was a no-op because a row already existed. Re-fetch it so the
  // caller always gets a row back; this is the price of idempotency.
  const existing = await getSubscription(userId);
  if (!existing) {
    // Theoretically unreachable: onConflictDoNothing returned no rows yet
    // there's no existing row. Treated as a real error so we don't lie to
    // the caller.
    throw new Error("SUBSCRIPTION_INSERT_FAILED");
  }
  return existing;
}

/**
 * Fetch the raw subscription row for a user, or null if none exists.
 */
export async function getSubscription(
  userId: string
): Promise<Subscription | null> {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, userId),
  });
  return row ?? null;
}

/**
 * Derive the effective subscription state for a user. The contract:
 *
 *  - If no row exists, return a defensive "expired free-trial" snapshot.
 *    This should not happen in practice (`startTrial` runs on every signup)
 *    but we don't want a missing row to crash auth-gated pages.
 *
 *  - `isActive` is true when the plan is paid + active, OR the user is on
 *    trial AND the trial end date has not passed. We compare timestamps in
 *    JS rather than at the DB so we don't need a SQL `now()` call per
 *    middleware hit.
 *
 *  - `daysLeftInTrial` is only meaningful while on trial. We `Math.ceil` so
 *    a user who signs up at 23:59 still sees "7 days left" instead of "6".
 *
 *  - We do NOT mutate the row here. Phase 6's cron job is responsible for
 *    flipping `status` to `"expired"`. Mutating on read would cause every
 *    page load to hit a write transaction.
 */
export async function checkSubscription(
  userId: string
): Promise<SubscriptionStateSnapshot> {
  const row = await getSubscription(userId);

  if (!row) {
    return {
      plan: "free_trial",
      status: "expired",
      isActive: false,
      daysLeftInTrial: null,
      nextResetAt: null,
      // Defensive default — see SubscriptionStateSnapshot#periodStartDate. The
      // missing-row branch is unreachable in production (`startTrial` runs on
      // every signup), but the column is non-nullable in every reachable case
      // so the snapshot type stays the same shape.
      periodStartDate: new Date(),
      proQuota: null,
    };
  }

  const now = Date.now();
  const trialEnd = row.trialEndDate.getTime();
  const plan = row.plan as SubscriptionPlan;
  const status = row.status as SubscriptionStatus;

  const trialActive = status === "trial" && trialEnd >= now;
  const paidActive = status === "active";
  const isActive = trialActive || paidActive;

  let daysLeftInTrial: number | null = null;
  if (status === "trial") {
    daysLeftInTrial = Math.max(0, Math.ceil((trialEnd - now) / MS_PER_DAY));
  }

  // Delegate the rolling-window math to the existing standalone helper so
  // there's exactly one implementation. Map its typed result onto the
  // snapshot's `Date | null` shape — UI callers don't need the reason code,
  // just the date (or absence thereof).
  const resetInfo = await nextResetAt(userId);
  const nextResetAtValue = resetInfo.at;

  // Phase 4 D-A19: surface the canonical Pro quota snapshot. Only populated
  // for active Pro — trial / Starter / inactive Pro all return `null` so the
  // UI can branch on presence without a second plan check. The literal
  // `max: 4` is intentional (matches the type declaration); changing the cap
  // would be a coordinated edit across this file, `MAX_BATCHES_PER_PERIOD`,
  // and the snapshot type.
  let proQuota: SubscriptionStateSnapshot["proQuota"] = null;
  if (plan === "pro" && status === "active") {
    const now = new Date();
    const quota = await getProQuotaState(userId, row, now);
    proQuota = {
      used: quota.used,
      max: 4,
      periodEndsAt: quota.periodEndsAt,
    };
  }

  return {
    plan,
    status,
    isActive,
    daysLeftInTrial,
    nextResetAt: nextResetAtValue,
    // D-S8: the immutable rolling-30-day anchor on the row. Surfaced for all
    // plans so the Scheduled-page window helper works without a Pro special
    // case. The Pro `proQuota.periodEndsAt` below is still
    // `periodStartDate + 30d` (via `getProQuotaState`), so existing consumers
    // are unaffected.
    periodStartDate: row.periodStartDate,
    proQuota,
  };
}

/**
 * Rolling-7-day window length in milliseconds. Phase 3 D4: a paid user gets a
 * fresh generation slot exactly 7 days after their last batch's `createdAt`,
 * regardless of that batch's status (cancelled batches still count — D12).
 */
const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Phase 4 Pro period length in milliseconds. Derived from the canonical
 * day count in `@/lib/pricing` so the pricing card copy and the gate math
 * can never drift.
 */
const PERIOD_MS = ROLLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Quota snapshot for an active Pro user — shared between {@link canGenerate}
 * (gate decision), `nextResetAt` (reset timing), and `checkSubscription`
 * (UI snapshot). Returned by {@link getProQuotaState} so all three callers
 * see identical numbers from a single DB round-trip.
 */
type ProQuotaState = {
  used: number;
  max: typeof MAX_BATCHES_PER_PERIOD;
  currentPeriodStart: Date;
  periodEndsAt: Date;
};

/**
 * Pure rollover helper — given the immutable subscription anchor and the
 * current time, returns the start of the current 30-day period.
 *
 * Implements D-A11: `floor((now - anchor) / PERIOD_MS) * PERIOD_MS + anchor`.
 * The rolled-forward value is **never written back** to the row — this is the
 * whole reason the formula is computed on read instead of stored. Pure JS,
 * no DB access, no `Date.now()` (the caller passes `now` so tests can
 * inject a deterministic clock).
 *
 * A future-dated anchor (clock skew, manual seeding) is handled by returning
 * the anchor itself — `elapsed < 0` would otherwise yield a negative period
 * count and place the period start ahead of the anchor.
 *
 * Exported (D-S8) so `postService.getScheduledViewForUser` can apply the same
 * window math to Trial/Starter snapshots — the Scheduled page surfaces the
 * current 30-day quota window for all plans, not just Pro. Re-implementing the
 * formula in two places would let it drift; a single exported helper keeps
 * Pro's gate math and the Scheduled page's window math in lockstep.
 */
export function computeCurrentPeriodStart(anchor: Date, now: Date): Date {
  const elapsed = now.getTime() - anchor.getTime();
  if (elapsed < 0) {
    // Future-dated anchor — guard against clock skew / manual seeding. The
    // current period hasn't started yet; treat the anchor itself as the
    // period start so callers compute a sane `periodEndsAt`.
    return anchor;
  }
  const periodsElapsed = Math.floor(elapsed / PERIOD_MS);
  return new Date(anchor.getTime() + periodsElapsed * PERIOD_MS);
}

/**
 * Pro quota state shared across `canGenerate`, `nextResetAt`, and the
 * `checkSubscription` snapshot — one DB round-trip, three callers.
 *
 * The cutoff is `max(currentPeriodStart, planChangedAt)` (D-A13): if the user
 * upgraded to Pro mid-period, batches created before that upgrade do not
 * count toward the 4-per-period cap. Strict `<` comparison matches Phase 3
 * D5 — a same-instant plan change still treats the simultaneous batch as
 * "pre-change" and counts it under the new plan.
 *
 * Counts **all** batches in the period regardless of status — cancelled and
 * scheduled batches both consume a slot (D-A16, parallel to Phase 3 D12 for
 * Starter). The raw `count(*)::int` cast pulls Postgres' bigint string into
 * a JS number at the SQL boundary so callers can compare it directly.
 */
async function getProQuotaState(
  userId: string,
  subscription: Subscription,
  now: Date,
): Promise<ProQuotaState> {
  const currentPeriodStart = computeCurrentPeriodStart(
    subscription.periodStartDate,
    now,
  );

  // D-A13: pre-upgrade batches don't count. Strict `<` is intentional —
  // matches Phase 3 D5's same-instant fail-closed behavior.
  const cutoff =
    currentPeriodStart.getTime() < subscription.planChangedAt.getTime()
      ? subscription.planChangedAt
      : currentPeriodStart;

  // D-A16: no status filter. Cancelled / scheduled / completed batches all
  // consume one of the four monthly slots.
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(weeklyBatches)
    .where(
      and(eq(weeklyBatches.userId, userId), gte(weeklyBatches.createdAt, cutoff)),
    );

  const used = row?.count ?? 0;

  return {
    used,
    max: MAX_BATCHES_PER_PERIOD,
    currentPeriodStart,
    periodEndsAt: new Date(currentPeriodStart.getTime() + PERIOD_MS),
  };
}

/**
 * Generation gate — the single permanent home for "is the user allowed to
 * create a weekly batch right now?". Called by
 * {@link postService.generateWeekly} immediately before the batch INSERT, and
 * by the `/create` page server-render to decide which gated screen (if any)
 * to show.
 *
 * Phase 3 / Phase 4 evaluation order (D13 + D-A10). The order is load-bearing —
 * re-read `specs/phase-3-subscription-gating/spec.md` § 5.1 and
 * `specs/phase-4-pro-monthly-quota/spec.md` § 5.1 before reordering:
 *
 *   1. No subscription row → `plan_inactive` (defensive; shouldn't happen
 *      because `startTrial` runs on signup).
 *   2. Trial user with any existing batch → `trial_batch_exists` (Phase 2
 *      D20: trial = 1 batch lifetime). Cancelled batches count.
 *   3. Cancelled/expired paid plan → `plan_inactive`. Free-trial-row in
 *      cancelled/expired falls through to the trial branch above instead.
 *   4. Starter with > 2 profile platforms → `starter_platforms_overage`.
 *      Only reachable via downgrade; profile save enforces this on entry.
 *   5a. Active Starter → rolling-7-day window check:
 *       - No prior batch → allowed.
 *       - Last batch predates the most recent plan change (D5) → allowed.
 *         Strict `<`: same-instant comparisons fail-closed to "still locked".
 *       - `now >= lastBatch.createdAt + 7d` → allowed.
 *       - Else → `weekly_cap_active` with the `nextResetAt` timestamp.
 *   5b. Active Pro → 30-day rolling 4-batch quota check (Phase 4 D-A1, D-A10):
 *       - Compute `currentPeriodStart` from `subscription.periodStartDate`
 *         in pure JS (D-A11). The anchor row is never mutated on read.
 *       - Cutoff = `max(currentPeriodStart, planChangedAt)` so pre-upgrade
 *         batches don't count (D-A13). Strict `<` matches Phase 3 D5.
 *       - COUNT all batches since the cutoff regardless of status (D-A16).
 *       - `count < 4` → allowed.
 *       - Else → `monthly_cap_active` with `nextResetAt = currentPeriodStart
 *         + 30d` and `batchesUsed = count`. New reason code distinct from
 *         `weekly_cap_active` so gate-screen copy can branch cleanly
 *         (D-A12).
 *   6. Any unhandled combo → `plan_inactive` (defensive fallthrough).
 *
 * Cancelled batches still count toward the 7-day window (D12) — the trial
 * cap and the paid-weekly cap share the same "any batch status counts" rule.
 *
 * The most-recent-batch query is inlined here against `weekly_batches`
 * rather than imported from postService because postService already imports
 * subscriptionService — pulling `getMostRecentBatch` back would form an
 * import cycle. Same escape hatch Phase 2 used for the trial-batch check.
 */
export async function canGenerate(userId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: "trial_batch_exists" }
  | { allowed: false; reason: "weekly_cap_active"; nextResetAt: Date }
  | {
      allowed: false;
      reason: "monthly_cap_active";
      nextResetAt: Date;
      batchesUsed: number;
    }
  | { allowed: false; reason: "starter_platforms_overage"; currentCount: number }
  | { allowed: false; reason: "plan_inactive" }
> {
  const subscription = await getSubscription(userId);

  // 1. Defensive: no row → treat as inactive rather than crash.
  if (!subscription) {
    return { allowed: false, reason: "plan_inactive" };
  }

  const plan = subscription.plan as SubscriptionPlan;
  const status = subscription.status as SubscriptionStatus;

  // 2. Trial users: 1-batch-lifetime cap (D20). Runs before the inactive-paid
  // branch so a trial user with a wrong plan field still gets the trial
  // gate, not a "plan inactive" surface they can't recover from.
  if (status === "trial") {
    const row = await db.query.weeklyBatches.findFirst({
      where: eq(weeklyBatches.userId, userId),
      columns: { id: true },
    });
    if (row) {
      return { allowed: false, reason: "trial_batch_exists" };
    }
    return { allowed: true };
  }

  // 3. Cancelled/expired paid plans: blocked outright. (Cancelled trial rows
  // are filtered out above by the `status === "trial"` branch.)
  if (
    (status === "cancelled" || status === "expired") &&
    plan !== "free_trial"
  ) {
    return { allowed: false, reason: "plan_inactive" };
  }

  // 4. Starter platform-cap defense (D6). Only reachable via downgrade — the
  // profile-save path rejects > 2 platforms for Starter users on entry.
  // Inlined as a direct SELECT (just the platforms column) rather than
  // calling profileService.getProfile — profile-service imports from this
  // file, so importing it back would form a cycle. Same escape hatch the
  // rolling-window batch lookup below uses against postService.
  if (plan === "starter") {
    const [profileRow] = await db
      .select({ platforms: profiles.platforms })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (profileRow && profileRow.platforms.length > 2) {
      return {
        allowed: false,
        reason: "starter_platforms_overage",
        currentCount: profileRow.platforms.length,
      };
    }
  }

  // 5a. Active Starter — rolling-7-day window. Unchanged from Phase 3.
  if (plan === "starter" && status === "active") {
    const lastBatch = await getMostRecentBatchInternal(userId);

    // First batch ever → allowed.
    if (!lastBatch) {
      return { allowed: true };
    }

    // Plan changed AFTER the last batch was created → fresh slot
    // immediately (D5). Strict `<`: a same-instant write should still
    // count as locked rather than over-grant.
    if (lastBatch.createdAt.getTime() < subscription.planChangedAt.getTime()) {
      return { allowed: true };
    }

    const nextReset = new Date(
      lastBatch.createdAt.getTime() + ROLLING_WINDOW_MS,
    );
    if (Date.now() >= nextReset.getTime()) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: "weekly_cap_active",
      nextResetAt: nextReset,
    };
  }

  // 5b. Active Pro — 30-day rolling 4-batch quota (Phase 4 D-A10).
  // No 7-day wait between batches — a Pro user may consume all 4 on day 1
  // (D-A3). The gate fires only when `used >= max`.
  if (plan === "pro" && status === "active") {
    const now = new Date();
    const quota = await getProQuotaState(userId, subscription, now);
    if (quota.used < quota.max) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "monthly_cap_active",
      nextResetAt: quota.periodEndsAt,
      batchesUsed: quota.used,
    };
  }

  // 6. Defensive fallthrough — unknown plan/status combo.
  return { allowed: false, reason: "plan_inactive" };
}

/**
 * Returned by {@link nextResetAt}. Either a real date (the moment the user
 * can next generate) or a typed reason explaining why no date applies — the
 * UI banner / TopBar countdown branches on this without re-implementing the
 * rolling-window math.
 */
export type NextResetInfo =
  | { at: Date }
  | { at: null; reason: "no_batch_yet" | "trial_user" | "inactive" };

/**
 * When does the user's next generation slot open? Mirrors
 * {@link canGenerate}'s branching but reports timing only — never allow/deny.
 *
 * Branches (order matches `canGenerate` — see Phase 3 spec § 5.1 and Phase 4
 * spec § 5.1 before reordering):
 *  - No subscription row → `inactive` (defensive).
 *  - Trial user → `{ at: null, reason: "trial_user" }`. Trial has no rolling
 *    window; the lifetime-1 cap doesn't expire.
 *  - Inactive paid plan (cancelled/expired and not free_trial) → `inactive`.
 *  - Active Starter, no prior batch → `no_batch_yet`.
 *  - Active Starter, prior batch predates the most recent plan change →
 *    `no_batch_yet` (the plan change reset the window, no batch counts).
 *  - Active Starter, otherwise → `{ at: lastBatch.createdAt + 7d }`. Returned
 *    even when the date is already in the past — the caller decides what to
 *    render.
 *  - Active Pro, at-cap (`used >= max`) →
 *    `{ at: currentPeriodStart + 30d }` (D-A14: the next monthly rollover).
 *  - Active Pro, under-cap → `{ at: null, reason: "no_batch_yet" }`
 *    (D-A14: parallel to Starter's under-cap; tells the UI "no countdown to
 *    render" — Pro under-cap has no future reset to show).
 *  - Defensive fallthrough → `inactive`.
 *
 * The Pro branch shares {@link getProQuotaState} with {@link canGenerate}, so
 * the two functions cannot drift on Pro by construction — same DB query, same
 * cutoff math, same `periodEndsAt`. Parity tests (task-08) lock this in.
 */
export async function nextResetAt(userId: string): Promise<NextResetInfo> {
  const subscription = await getSubscription(userId);

  // No row → treat the same as inactive paid for UI purposes (the banner
  // simply won't render in this case).
  if (!subscription) {
    return { at: null, reason: "inactive" };
  }

  const plan = subscription.plan as SubscriptionPlan;
  const status = subscription.status as SubscriptionStatus;

  if (status === "trial") {
    return { at: null, reason: "trial_user" };
  }

  if (
    (status === "cancelled" || status === "expired") &&
    plan !== "free_trial"
  ) {
    return { at: null, reason: "inactive" };
  }

  // Active Starter — rolling-7-day window. Unchanged from Phase 3.
  if (plan === "starter" && status === "active") {
    // For any other state, the rolling-window math depends on the most-recent
    // batch — same query used by `canGenerate` above.
    const lastBatch = await getMostRecentBatchInternal(userId);

    if (!lastBatch) {
      return { at: null, reason: "no_batch_yet" };
    }

    // A plan change after the last batch effectively resets the window; the
    // user can generate immediately, so there's no future reset date to show.
    if (lastBatch.createdAt.getTime() < subscription.planChangedAt.getTime()) {
      return { at: null, reason: "no_batch_yet" };
    }

    return {
      at: new Date(lastBatch.createdAt.getTime() + ROLLING_WINDOW_MS),
    };
  }

  // Active Pro — 30-day monthly quota (D-A14). Shares `getProQuotaState` with
  // `canGenerate` so the two functions cannot drift on Pro by construction.
  if (plan === "pro" && status === "active") {
    const now = new Date();
    const quota = await getProQuotaState(userId, subscription, now);
    if (quota.used >= quota.max) {
      return { at: quota.periodEndsAt };
    }
    return { at: null, reason: "no_batch_yet" };
  }

  // Defensive fallthrough — unknown plan/status combo. Matches `canGenerate`'s
  // final `plan_inactive` line.
  return { at: null, reason: "inactive" };
}

/**
 * Dev/admin-only plan helper. Updates `plan`, derives `status` from the new
 * plan (`free_trial → "trial"`, `starter | pro → "active"`), and bumps
 * `planChangedAt` to `now()` — even when the plan value is unchanged, which
 * is intentional: a dev can call `setPlan(userId, currentPlan)` to "reset
 * the rolling-7-day window" while testing. Phase 3 is monthly-only, so
 * `billingCycle` is deliberately left untouched (Phase 5 owns annual).
 *
 * **Phase 4 D-A18 — Pro period anchor semantics.** When the call transitions
 * the user **into Pro from a non-Pro plan**, we additionally set
 * `periodStartDate = now()` so the 30-day rolling quota anchors at the moment
 * of upgrade. The guard is intentionally `existing.plan !== "pro"` (not "any
 * change" or "status flipped"): calling `setPlan(userId, "pro")` on a row
 * that is *already* Pro must NOT re-anchor the period — doing so would
 * silently erase the user's accumulated quota usage by sliding the window
 * forward, effectively doubling their monthly cap (the count query in
 * {@link getProQuotaState} starts from `currentPeriodStart`, so a fresh
 * anchor with `used = 0` is observable as "8 batches in a real month"). The
 * `plan === "pro" && existing.plan !== "pro"` check is the only condition
 * that captures "first arrival in Pro" without mis-firing on Pro→Pro
 * resets, plan-unchanged debug bumps, or Pro→Starter→Pro round-trips (the
 * intermediate Starter write already shifted `existing.plan` so the second
 * Pro arrival correctly re-anchors).
 *
 * Off-Pro transitions (Pro→Starter, Starter→free_trial, etc.) deliberately
 * leave `periodStartDate` alone. Non-Pro plans don't read the column at all
 * — Starter uses the rolling-7-day window keyed off `weekly_batches.createdAt`
 * — so a stale anchor is harmless ballast, and preserving it means a future
 * re-upgrade back into Pro still works correctly via the non-Pro → Pro arm
 * of the same guard. The TypeScript-side check (rather than an SQL `CASE
 * WHEN`) keeps the comparison readable and lets the spec be a single line of
 * code reviewers can grep for.
 *
 * **DO NOT export this from any `actions.ts` file.** Phase 3 has no
 * upgrade UI — manual plan seeding only, called from a one-off script or
 * directly via Drizzle Studio. Wrapping this in a server action would let
 * the client mutate their own subscription, which Phase 5's real billing
 * flow is responsible for instead. The Phase 3 security audit (task-15)
 * greps `src/app/` for `setPlan` and expects zero hits.
 *
 * @throws If no subscription row exists for `userId`. Callers should ensure
 *   a row exists (every signup creates one via `startTrial`) before invoking.
 *   The check happens twice — once on the pre-read (so we never issue a
 *   write that would no-op) and once on the post-update (belt-and-suspenders
 *   for a row deleted between the SELECT and UPDATE).
 */
export async function setPlan(
  userId: string,
  plan: SubscriptionPlan,
): Promise<Subscription> {
  // Derive status from plan. The two terminal states (`cancelled`,
  // `expired`) are only reachable via Phase 5 billing events, not via this
  // helper — operators that need them flip `status` directly in Drizzle
  // Studio.
  const status: SubscriptionStatus = plan === "free_trial" ? "trial" : "active";
  const now = new Date();

  // Read the existing plan once so we can decide whether we're entering Pro
  // from a non-Pro state. Calling setPlan on an already-Pro row must NOT
  // reset periodStartDate (would silently double the user's quota by
  // erasing accumulated usage from the current window).
  const existing = await getSubscription(userId);
  if (!existing) throw new Error("SUBSCRIPTION_NOT_FOUND");

  const enteringPro = plan === "pro" && existing.plan !== "pro";

  const updates: Partial<typeof subscriptions.$inferInsert> = {
    plan,
    status,
    planChangedAt: now,
  };
  if (enteringPro) {
    updates.periodStartDate = now;
  }

  const [updated] = await db
    .update(subscriptions)
    .set(updates)
    .where(eq(subscriptions.userId, userId))
    .returning();

  if (!updated) {
    // No row matched — caller passed a userId without a subscription, or the
    // row was deleted between the pre-SELECT and this UPDATE. We surface
    // this rather than silently no-op so dev/QA scripts fail loudly.
    throw new Error("SUBSCRIPTION_NOT_FOUND");
  }

  return updated;
}

/**
 * Internal helper — most-recent batch in ANY status (including `cancelled`,
 * `scheduled`, `completed`). Inlined here rather than imported from
 * postService because postService already imports subscriptionService;
 * pulling its `getMostRecentBatch` export back would form a cycle. Same
 * escape hatch the Phase 2 trial-batch existence check uses on this file.
 *
 * Returns only the columns the gate actually needs (`createdAt`) so the
 * query stays cheap on the hot `/create` page-load path.
 */
async function getMostRecentBatchInternal(
  userId: string,
): Promise<{ createdAt: Date } | null> {
  const [row] = await db
    .select({ createdAt: weeklyBatches.createdAt })
    .from(weeklyBatches)
    .where(eq(weeklyBatches.userId, userId))
    .orderBy(desc(weeklyBatches.createdAt))
    .limit(1);

  return row ?? null;
}
