# Task 04: canGenerate — Pro Branch + monthly_cap_active Reason

## Status
not started

## Wave
2

## Description

Split `canGenerate`'s active-paid branch (branch 5) by plan. Starter keeps its existing rolling-7-day, 1-batch logic — **unchanged**. Pro gets new logic: 4 batches per 30-day rolling period since `max(currentPeriodStart, planChangedAt)`. Introduce `monthly_cap_active` as a new discriminated-union variant on the return type (D-A10, D-A12).

Add an internal helper `computeCurrentPeriodStart(anchor: Date, now: Date): Date` (pure function, no DB access) implementing the D-A11 rollover formula: `floor((now - anchor) / 30d) * 30d + anchor`. Reuse this helper in `nextResetAt` (task 05) and the snapshot computation (task 06).

Also add an internal helper that counts batches + computes the period anchor — shared with tasks 05 and 06 to avoid extra DB round-trips.

## Dependencies

**Depends on:** task-01 (`period_start_date` column must exist)
**Blocks:** task-05 (mirror branching), task-06 (read shared helper), task-12 (/create page reads `monthly_cap_active`), task-13 (gate-screen variant)
**Context from dependencies:** task-01 adds `subscriptions.period_start_date` (not null, default `now()`, backfilled to `plan_changed_at`).

**Wave 2 sequencing:** This task touches `src/lib/services/subscription-service.ts`. All Wave 2 tasks (04–08) edit the same file and **must run sequentially**, not in parallel.

## Files to Modify

- `src/lib/services/subscription-service.ts` (modified)

## Implementation Steps

### 1. Extend the return type

```ts
export async function canGenerate(userId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: "trial_batch_exists" }
  | { allowed: false; reason: "weekly_cap_active"; nextResetAt: Date }
  | { allowed: false; reason: "monthly_cap_active"; nextResetAt: Date; batchesUsed: number }
  | { allowed: false; reason: "starter_platforms_overage"; currentCount: number }
  | { allowed: false; reason: "plan_inactive" }
>
```

### 2. Add the pure rollover helper

```ts
import { ROLLING_PERIOD_DAYS } from "@/lib/pricing";

const PERIOD_MS = ROLLING_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Returns the start of the current 30-day Pro period given the immutable
 * anchor and the current time. Pure JS — never writes the rolled-forward
 * value back to the row (D-A11).
 */
function computeCurrentPeriodStart(anchor: Date, now: Date): Date {
  const elapsed = now.getTime() - anchor.getTime();
  if (elapsed < 0) return anchor; // future-dated anchor — guard against clock skew
  const periodsElapsed = Math.floor(elapsed / PERIOD_MS);
  return new Date(anchor.getTime() + periodsElapsed * PERIOD_MS);
}
```

### 3. Add the shared Pro-status helper

```ts
type ProQuotaState = {
  used: number;
  max: 4;
  currentPeriodStart: Date;
  periodEndsAt: Date;
};

async function getProQuotaState(
  userId: string,
  subscription: Subscription,
  now: Date,
): Promise<ProQuotaState> {
  const currentPeriodStart = computeCurrentPeriodStart(subscription.periodStartDate, now);
  const cutoff =
    currentPeriodStart.getTime() < subscription.planChangedAt.getTime()
      ? subscription.planChangedAt
      : currentPeriodStart;

  // Count ALL batches in the period regardless of status (D-A16).
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.userId, userId), gte(weeklyBatches.createdAt, cutoff)));

  return {
    used: count,
    max: 4,
    currentPeriodStart,
    periodEndsAt: new Date(currentPeriodStart.getTime() + PERIOD_MS),
  };
}
```

(Exact imports — `sql`, `and`, `gte` — from `drizzle-orm`. Match the file's existing import style.)

### 4. Split branch 5

Replace the single `(plan === "starter" || plan === "pro") && status === "active"` block with two:

```ts
// 5a. Active Starter — existing rolling-7-day logic. UNCHANGED.
if (plan === "starter" && status === "active") {
  // ...existing code: getMostRecentBatchInternal, planChangedAt comparison,
  // ROLLING_WINDOW_MS, weekly_cap_active...
}

// 5b. Active Pro — new monthly quota logic.
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
```

### 5. Documentation

- Update the JSDoc on `canGenerate` (top of the function) to describe the new Pro branch and the `monthly_cap_active` reason.
- Inline-comment the order of evaluation (matches Phase 3 style — `specs/phase-4-pro-monthly-quota/spec.md § 5.1` reference).
- Document `computeCurrentPeriodStart` with a note pointing to D-A11.

### 6. Import notes

- Import `ROLLING_PERIOD_DAYS` and `MAX_BATCHES_PER_PERIOD` from `@/lib/pricing`.
- Add Drizzle helpers `sql`, `and`, `gte` to existing `drizzle-orm` imports.
- Keep the file's existing import-cycle escape hatch pattern (direct queries against `weeklyBatches`, no `postService` import).

## Acceptance Criteria

- [ ] `canGenerate` return type includes the new `monthly_cap_active` variant.
- [ ] Starter branch is byte-for-byte equivalent to its previous behavior.
- [ ] Pro branch returns `allowed: true` when `quota.used < 4`.
- [ ] Pro branch returns `monthly_cap_active` when `quota.used >= 4`, with `nextResetAt = currentPeriodStart + 30d` and `batchesUsed = quota.used`.
- [ ] `computeCurrentPeriodStart` is a pure function (no DB access, no Date.now()).
- [ ] `getProQuotaState` uses `max(currentPeriodStart, planChangedAt)` as the cutoff (D-A13).
- [ ] No filter on batch status in the COUNT query (D-A16).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The Pro evaluation order matters: trial check first (so a trial user with a wrong plan still gets the trial gate), then inactive-paid, then starter-platforms-overage, then the active-paid split. Do not reorder.
- The `currentPeriodStart < planChangedAt` situation arises after an upgrade mid-period; the cutoff jumps forward to `planChangedAt`, so pre-Pro batches don't count. Strict `<` is intentional (matches Phase 3 D5).
- Do not write the rolled-forward `period_start_date` back to the row in this task or any later task. The anchor is immutable; rollover is computed (D-A11).
- The helper functions (`computeCurrentPeriodStart`, `getProQuotaState`) are file-private. Do not export — they're reused only by task 05 and task 06 inside the same file.
- The COUNT query is intentionally raw `sql<number>` because Drizzle's typed COUNT often returns a string from Postgres; cast to int at the SQL boundary to avoid a JS parse hop.
