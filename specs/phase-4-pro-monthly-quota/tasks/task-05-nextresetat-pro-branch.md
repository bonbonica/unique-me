# Task 05: nextResetAt — Pro Branch

## Status
not started

## Wave
2

## Description

Add the matching Pro branch to `nextResetAt`. The existing return shape stays:

```ts
{ at: Date } | { at: null; reason: "no_batch_yet" | "trial_user" | "inactive" }
```

For Pro:
- At-cap (`quota.used >= 4`) → `{ at: currentPeriodStart + 30d }`.
- Under-cap → `{ at: null, reason: "no_batch_yet" }` (parallel to Starter's under-cap shape; tells the UI "no countdown to render").

Reuses the `getProQuotaState` helper introduced in task 04 — no extra DB round-trip beyond what `canGenerate` does, and the two functions cannot drift on the Pro branch because they share the helper.

## Dependencies

**Depends on:** task-04 (`getProQuotaState`, `computeCurrentPeriodStart` helpers + Pro branch must exist)
**Blocks:** task-06 (snapshot reuses the same helper), task-08 (parity tests assert agreement)
**Context from dependencies:** task-04 introduces the file-private `getProQuotaState(userId, subscription, now)` helper that returns `{ used, max, currentPeriodStart, periodEndsAt }`.

**Wave 2 sequencing:** This task touches `src/lib/services/subscription-service.ts`. Tasks 04–08 are sequential, not parallel.

## Files to Modify

- `src/lib/services/subscription-service.ts` (modified)

## Implementation Steps

### 1. Add Pro branch to `nextResetAt`

Existing function structure (Phase 3): trial → `trial_user`; cancelled/expired paid → `inactive`; then for active paid plans, look up last batch + apply rolling-7d math.

Split the active-paid branch by plan, matching task 04's pattern:

```ts
// Active Starter — existing logic. UNCHANGED.
if (plan === "starter" && status === "active") {
  // ...existing code: getMostRecentBatchInternal, planChangedAt comparison,
  // ROLLING_WINDOW_MS, return Date or no_batch_yet...
}

// Active Pro — monthly quota.
if (plan === "pro" && status === "active") {
  const now = new Date();
  const quota = await getProQuotaState(userId, subscription, now);
  if (quota.used >= quota.max) {
    return { at: quota.periodEndsAt };
  }
  return { at: null, reason: "no_batch_yet" };
}
```

### 2. Keep the evaluation order aligned with `canGenerate`

The branch order in `nextResetAt` must match `canGenerate`:

1. No row → `inactive`
2. Trial → `trial_user`
3. Cancelled/expired paid (non-free_trial) → `inactive`
4. Active Starter → existing logic
5. Active Pro → new branch (this task)
6. Defensive fallthrough → `inactive`

Do not reorder. The two functions are kept in sync by tooling (task-08 parity test) AND by structure (same order, same helper).

### 3. Documentation

- Update the JSDoc on `nextResetAt` to describe the Pro at-cap and under-cap returns.
- Add a one-liner comment at the top of the Pro branch pointing to D-A14 in the spec.
- Note in the JSDoc that the Pro and `canGenerate` branches share `getProQuotaState` — drift is prevented by construction.

## Acceptance Criteria

- [ ] `nextResetAt` returns `{ at: currentPeriodStart + 30d }` when Pro is at-cap.
- [ ] `nextResetAt` returns `{ at: null, reason: "no_batch_yet" }` when Pro is under-cap.
- [ ] Starter branch is byte-for-byte equivalent to its previous behavior.
- [ ] `nextResetAt` and `canGenerate` agree by construction: both call `getProQuotaState`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- Pro under-cap returns `no_batch_yet` rather than a fresh reason like `pro_under_cap`. Rationale: the UI doesn't need a different reason — it already branches on plan via the snapshot, and `no_batch_yet` tells the topbar pill "no countdown" (which is what we want).
- Do NOT add a new reason code for Pro under-cap. The existing three (`no_batch_yet`, `trial_user`, `inactive`) cover the cases — keep the surface small.
- The "under-cap means no future reset to show" semantics mirror Starter's "no batch yet" case, which the dashboard banner already handles by switching to the "allowed" state.
