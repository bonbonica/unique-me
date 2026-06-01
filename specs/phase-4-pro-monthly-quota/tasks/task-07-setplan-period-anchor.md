# Task 07: setPlan — Period Anchor on Pro Transitions

## Status
not started

## Wave
2

## Description

Extend `setPlan` so that transitioning into Pro from a non-Pro plan also sets `period_start_date = now()` (D-A18). The existing `plan_changed_at` bump is preserved. Off-Pro transitions leave `period_start_date` alone (harmless; non-Pro plans don't read it).

This keeps the "upgrade mid-period = fresh allowance" edge case correct. Without this change, a Pro upgrade would inherit the old `period_start_date` from whenever the row was first created, which is wrong.

## Dependencies

**Depends on:** task-06 (the snapshot field exists, so any test of the upgrade flow can observe period_start_date via checkSubscription)
**Blocks:** task-08 (parity tests cover plan-change semantics)
**Context from dependencies:** Tasks 04–06 established the helper, branching, and snapshot. This task adds the only mutating piece in `subscription-service.ts`.

**Wave 2 sequencing:** Same file. Sequential after 06.

## Files to Modify

- `src/lib/services/subscription-service.ts` (modified)

## Implementation Steps

### 1. Update `setPlan` body

Current behavior: bumps `plan` + `status` + `planChangedAt` unconditionally.

New behavior: if the target plan is `"pro"` AND the existing row's plan is NOT `"pro"`, also set `period_start_date = now()`.

```ts
export async function setPlan(
  userId: string,
  plan: SubscriptionPlan,
): Promise<Subscription> {
  const status: SubscriptionStatus = plan === "free_trial" ? "trial" : "active";
  const now = new Date();

  // Read the existing plan once to decide whether we're entering Pro.
  // Pulling the full row lets the helper avoid a second SELECT after the UPDATE.
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

  if (!updated) throw new Error("SUBSCRIPTION_NOT_FOUND");
  return updated;
}
```

### 2. Preserve idempotency for `setPlan(userId, currentPlan)` calls

A dev calling `setPlan(userId, "pro")` on an already-Pro row should still bump `planChangedAt` (so the dev's "reset the rolling window" intent works) but should NOT bump `periodStartDate` (otherwise calling the helper on a current Pro row would erase the original anchor and the user's quota would silently double).

The `enteringPro` check above (`existing.plan !== "pro"`) handles this correctly. **Do not** change it to `plan === "pro"` only.

### 3. Documentation

- Update the JSDoc on `setPlan` to describe the periodStartDate semantics.
- Note the "DO NOT export from server actions" rule is unchanged — the Phase 3 audit comment stays.
- Add an inline comment explaining the `enteringPro` check (why `!== "pro"` is the right guard).

## Acceptance Criteria

- [ ] `setPlan(userId, "pro")` on a non-Pro row sets `period_start_date = now()` AND `plan_changed_at = now()`.
- [ ] `setPlan(userId, "pro")` on an already-Pro row bumps `plan_changed_at` but leaves `period_start_date` unchanged.
- [ ] `setPlan(userId, "starter")` or `setPlan(userId, "free_trial")` leaves `period_start_date` unchanged.
- [ ] Error path on missing row preserved (`SUBSCRIPTION_NOT_FOUND`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The pre-SELECT (`getSubscription(userId)`) adds one round-trip but eliminates the need for SQL-side `CASE WHEN plan != 'pro'` logic — keeps the change purely TypeScript-side and easy to test.
- A future Phase 5 helper that handles Polar webhook events will reuse the same `enteringPro` semantics — flag this for that phase but do not implement now.
- `setPlan` remains dev/admin only. The Phase 3 audit invariant (`grep -r "setPlan" src/app/` returns zero) is enforced in task 19.
- Off-Pro → Pro transition is the only place `period_start_date` is mutated by application code. Migration `0006` is the only other write. Anywhere else writing this column is a bug.
