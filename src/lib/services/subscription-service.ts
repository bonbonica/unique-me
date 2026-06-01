// Phase 1: subscription-service. Owns the trial lifecycle — start, lookup,
// and active-state derivation. Phase 6 will add Polar billing integration and
// a cron job that flips expired trials to `status: "expired"`; until then
// expiry is computed on read.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
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
 */
export type SubscriptionStateSnapshot = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  isActive: boolean;
  daysLeftInTrial: number | null;
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

  return {
    plan,
    status,
    isActive,
    daysLeftInTrial,
  };
}

/**
 * Rolling-7-day window length in milliseconds. Phase 3 D4: a paid user gets a
 * fresh generation slot exactly 7 days after their last batch's `createdAt`,
 * regardless of that batch's status (cancelled batches still count — D12).
 */
const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generation gate — the single permanent home for "is the user allowed to
 * create a weekly batch right now?". Called by
 * {@link postService.generateWeekly} immediately before the batch INSERT, and
 * by the `/create` page server-render to decide which gated screen (if any)
 * to show.
 *
 * Phase 3 evaluation order (D13). The order is load-bearing — re-read
 * `specs/phase-3-subscription-gating/spec.md` § 5.1 before reordering:
 *
 *   1. No subscription row → `plan_inactive` (defensive; shouldn't happen
 *      because `startTrial` runs on signup).
 *   2. Trial user with any existing batch → `trial_batch_exists` (Phase 2
 *      D20: trial = 1 batch lifetime). Cancelled batches count.
 *   3. Cancelled/expired paid plan → `plan_inactive`. Free-trial-row in
 *      cancelled/expired falls through to the trial branch above instead.
 *   4. Starter with > 2 profile platforms → `starter_platforms_overage`.
 *      Only reachable via downgrade; profile save enforces this on entry.
 *   5. Active paid (Starter or Pro) → rolling-7-day window check:
 *      - No prior batch → allowed.
 *      - Last batch predates the most recent plan change (D5) → allowed.
 *        Strict `<`: same-instant comparisons fail-closed to "still locked".
 *      - `now >= lastBatch.createdAt + 7d` → allowed.
 *      - Else → `weekly_cap_active` with the `nextResetAt` timestamp.
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

  // 5. Active paid (Starter or Pro): rolling-7-day window.
  if ((plan === "starter" || plan === "pro") && status === "active") {
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
 * Branches:
 *  - Trial user → `{ at: null, reason: "trial_user" }`. Trial has no rolling
 *    window; the lifetime-1 cap doesn't expire.
 *  - Inactive paid plan (cancelled/expired and not free_trial) → `inactive`.
 *  - Active paid plan, no prior batch → `no_batch_yet`.
 *  - Active paid plan, prior batch predates the most recent plan change →
 *    `no_batch_yet` (the plan change reset the window, no batch counts).
 *  - Otherwise → `{ at: lastBatch.createdAt + 7d }`. Returned even when the
 *    date is already in the past — the caller decides what to render.
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

/**
 * Dev/admin-only plan helper. Updates `plan`, derives `status` from the new
 * plan (`free_trial → "trial"`, `starter | pro → "active"`), and bumps
 * `planChangedAt` to `now()` — even when the plan value is unchanged, which
 * is intentional: a dev can call `setPlan(userId, currentPlan)` to "reset
 * the rolling-7-day window" while testing. Phase 3 is monthly-only, so
 * `billingCycle` is deliberately left untouched (Phase 5 owns annual).
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

  const [updated] = await db
    .update(subscriptions)
    .set({
      plan,
      status,
      planChangedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId))
    .returning();

  if (!updated) {
    // No row matched — caller passed a userId without a subscription. We
    // surface this rather than silently no-op so dev/QA scripts fail loudly.
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
