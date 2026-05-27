// Phase 1: subscription-service. Owns the trial lifecycle — start, lookup,
// and active-state derivation. Phase 6 will add Polar billing integration and
// a cron job that flips expired trials to `status: "expired"`; until then
// expiry is computed on read.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  type Subscription,
  type SubscriptionPlan,
  type SubscriptionStatus,
  subscriptions,
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
