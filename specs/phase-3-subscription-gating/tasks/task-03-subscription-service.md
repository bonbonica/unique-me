# Task 03: subscriptionService — Extend canGenerate, Add nextResetAt + setPlan

## Status
not started

## Wave
2

## Description

Three changes to `src/lib/services/subscription-service.ts`:

1. **Extend `canGenerate`** to return a 4-reason discriminated union (D13). Phase 2's `trial_batch_exists` stays; add `weekly_cap_active`, `starter_platforms_overage`, `plan_inactive`. The body implements the rolling-7-day gate, plan-change reset, and Starter platform-cap defense.
2. **Add `nextResetAt(userId)`** — returns the timestamp when the user can next generate, or a typed reason if not applicable. Powers the dashboard banner and TopBar countdown.
3. **Add `setPlan(userId, plan)`** — dev-only admin helper. Updates `plan`, `status`, and `planChangedAt` atomically. **Not exported as a server action.**

## Dependencies

**Depends on:** task-01 (`plan_changed_at` column must exist)
**Blocks:** task-07 (`/create` gate branches), task-10 (banner reads `canGenerate`), task-11 (TopBar reads `nextResetAt`), task-13 (settings reads `nextResetAt`)
**Context from dependencies:** task-01 adds `subscriptions.plan_changed_at` (not null, default now, backfilled to `created_at` for existing rows).

## Files to Modify

- `src/lib/services/subscription-service.ts` (modified)

## Implementation Steps

### 1. Extend `canGenerate` return type

```ts
export async function canGenerate(userId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: "trial_batch_exists" }
  | { allowed: false; reason: "weekly_cap_active"; nextResetAt: Date }
  | { allowed: false; reason: "starter_platforms_overage"; currentCount: number }
  | { allowed: false; reason: "plan_inactive" }
>
```

### 2. Implementation logic (in order)

```
load subscription via getSubscription(userId)
if !row: return plan_inactive (defensive)

if status === "trial":
  if any batch exists for userId (any status): return trial_batch_exists
  else: return allowed: true

if status in {"cancelled", "expired"} and plan !== "free_trial":
  return plan_inactive

if plan === "starter":
  load profile.platforms via profileService.getProfile
  if platforms.length > 2:
    return starter_platforms_overage with currentCount

if plan in {"starter", "pro"} and status === "active":
  load postService.getMostRecentBatch(userId)  // already exists from Phase 2 polish
  if !lastBatch: return allowed: true
  if lastBatch.createdAt < subscription.planChangedAt:
    return allowed: true   // fresh batch on plan change
  nextResetAt = lastBatch.createdAt + 7 days
  if now >= nextResetAt: return allowed: true
  return weekly_cap_active with nextResetAt

return plan_inactive  // defensive fallthrough
```

### 3. Add `nextResetAt(userId)`

```ts
export type NextResetInfo =
  | { at: Date }
  | { at: null; reason: "no_batch_yet" | "trial_user" | "inactive" };

export async function nextResetAt(userId: string): Promise<NextResetInfo> {
  // Mirror canGenerate's branching but only report timing, not allow/deny.
  // Used by the dashboard banner + TopBar countdown.
}
```

Logic:
- Trial user → `{ at: null, reason: "trial_user" }`.
- Inactive paid plan → `{ at: null, reason: "inactive" }`.
- Active paid plan with no batches → `{ at: null, reason: "no_batch_yet" }`.
- Active paid plan with prior batch + plan-change later than batch → `{ at: null, reason: "no_batch_yet" }` (functionally same as no-batch).
- Otherwise → `{ at: lastBatch.createdAt + 7d }`.

### 4. Add `setPlan(userId, plan)`

```ts
export async function setPlan(
  userId: string,
  plan: SubscriptionPlan
): Promise<Subscription> {
  // Map plan → status:
  //   free_trial → "trial"
  //   starter | pro → "active"
  // Update plan, status, planChangedAt = new Date(). Don't touch billingCycle in
  // Phase 3 — annual arrives with Phase 5.
  // Idempotent: same plan still bumps planChangedAt (lets a dev reset the week).
  // Returns the updated row.
}
```

### 5. Documentation

- Update the existing JSDoc on `canGenerate` to remove the "Phase 3 will expand" note (we're doing it now).
- Add a JSDoc block on `setPlan` flagging it as **dev/admin only** and explicitly forbidding it from being wrapped in a server action.

### 6. Import notes

- `profileService.getProfile` is needed for the Starter overage check — already exists. Add it to imports.
- `postService.getMostRecentBatch` is needed — already exists from Phase 2 polish. Add it to imports. Be alert for import cycles; if Drizzle complains, inline the query directly against `weeklyBatches` here (matches the pattern Phase 2 used to avoid the cycle for the trial-batch existence check).

## Acceptance Criteria

- [ ] `canGenerate` returns each of the 4 union variants correctly under unit-equivalent manual testing (no automated tests in scope, but each branch must be reachable via Drizzle Studio state setup).
- [ ] `nextResetAt(userId)` returns the same date that `canGenerate` would use in its `weekly_cap_active` branch.
- [ ] `setPlan` bumps `planChangedAt` even when called with the user's current plan.
- [ ] `setPlan` is NOT exported from any file under `src/app/**/actions.ts`. Verify: `grep -r "setPlan" src/app/` returns zero results.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The `canGenerate` evaluation order matters: trial check first (so a trial user with a batch always gets `trial_batch_exists` even if they somehow have a wrong plan field), then inactive-paid, then platforms-overage, then weekly cap. Don't reorder without reading the spec § 5.1 again.
- The "fresh batch on plan change" branch (`lastBatch.createdAt < planChangedAt`) is the only place the `planChangedAt` column gets read. Keep the comparison `<`, not `<=` — same-instant comparisons should fail-safe to "still locked" rather than over-granting.
- The cancelled-recoverable flow from Phase 2 is unchanged: cancelled batches still count toward the rolling 7-day window (D12). Don't add a special case.
