# Task 06: SubscriptionStateSnapshot — Add proQuota Field

## Status
not started

## Wave
2

## Description

Extend `SubscriptionStateSnapshot` (the type returned by `checkSubscription`) with a `proQuota` field so UI surfaces (topbar pill, dashboard banner, settings plan section) can render "X of 4 used" without a second DB call (D-A19).

```ts
proQuota: { used: number; max: 4; periodEndsAt: Date } | null;
```

`proQuota` is non-null only when `plan === "pro" && status === "active"`. Computed by the same `getProQuotaState` helper added in task 04 — zero extra DB round-trips.

## Dependencies

**Depends on:** task-05 (Pro branching established, helper proven to compose)
**Blocks:** task-07 (setPlan extension touches the same file), task-12 (/create reads proQuota), task-14/15/16 (UI surfaces consume it)
**Context from dependencies:** task-04 added `getProQuotaState`; task-05 confirmed it composes cleanly in two callsites.

**Wave 2 sequencing:** Same file as 04, 05. Sequential.

## Files to Modify

- `src/lib/services/subscription-service.ts` (modified)

## Implementation Steps

### 1. Extend the type

```ts
export type SubscriptionStateSnapshot = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  isActive: boolean;
  daysLeftInTrial: number | null;
  nextResetAt: Date | null;
  proQuota: { used: number; max: 4; periodEndsAt: Date } | null;
};
```

### 2. Populate in `checkSubscription`

In the existing `checkSubscription` body, add:

```ts
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
  proQuota,
};
```

Place the Pro quota computation AFTER the existing `nextResetAt(userId)` call. Both calls run for active Pro users — that's two DB round-trips today, but task-08 will assert they agree by construction. A future refactor (out of scope for Phase 4) could collapse them into a single helper that returns both; defer that until the parity test pins down behavior.

### 3. Defensive defaults

- For a missing subscription row, `proQuota` is `null` (parallel to `nextResetAt: null`).
- For trial / Starter / inactive Pro rows, `proQuota` is `null`.
- The `max: 4` literal is duplicated from `MAX_BATCHES_PER_PERIOD` deliberately — keeps the snapshot type self-describing without forcing every consumer to import a constant. TypeScript will catch divergence if the constant ever moves.

### 4. Documentation

- Update the JSDoc on `SubscriptionStateSnapshot` to describe `proQuota` semantics.
- Note that `proQuota` and `nextResetAt` carry related information for Pro at-cap users — UI may render whichever is more idiomatic for its surface (pill prefers count; banner prefers date).

## Acceptance Criteria

- [ ] `SubscriptionStateSnapshot.proQuota` is typed `{ used: number; max: 4; periodEndsAt: Date } | null`.
- [ ] `checkSubscription` returns `proQuota !== null` only for active Pro users.
- [ ] `proQuota.used` matches the value `canGenerate` and `nextResetAt` would derive.
- [ ] No extra DB queries beyond the existing `getSubscription` + `nextResetAt` + the new `getProQuotaState` call (one COUNT and no row-fetch).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The literal `max: 4` is intentional — the type is fingerprintable and clearly documents "this is 4." If Phase 5 introduces tiers with different caps, refactor then.
- Do NOT widen `proQuota` to include `currentPeriodStart` or `batchesRemaining` — the UI can compute those (`max - used`, `periodEndsAt - 30d`) and we keep the snapshot lean.
- Do NOT cache the snapshot in this task. Future caching (e.g. React `cache()` per request) is a downstream optimisation; this task only adds a field.
