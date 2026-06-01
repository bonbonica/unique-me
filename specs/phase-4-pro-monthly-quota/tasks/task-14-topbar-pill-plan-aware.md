# Task 14: QuotaCountdownPill — Plan-Aware Rendering

## Status
not started

## Wave
4

## Description

Make `<QuotaCountdownPill />` plan-aware. Today it takes a single `nextResetAt: Date` and shows "Next batch · {N}d". For Pro:

- **Under-cap** → "{N} batches left" (where N = `max - used`).
- **At-cap** → "Resets in {N}d".
- **Starter** → existing "Next batch · {N}d" (unchanged).
- **Trial** → component not rendered (per Phase 3).

The parent (`<DashboardTopBar />`) passes the new props.

## Dependencies

**Depends on:** task-06 (snapshot's `proQuota` provides the count + period end date)
**Blocks:** task-19
**Context from dependencies:** task-06 adds `proQuota: { used, max: 4, periodEndsAt } | null` to the snapshot. Topbar reads the snapshot already.

## Files to Modify

- `src/components/dashboard/quota-countdown-pill.tsx` (modified) — accept new props, branch on plan
- `src/components/dashboard/top-bar.tsx` (modified) — pass new props from snapshot

## Implementation Steps

### 1. New prop shape on the pill

Discriminated union avoids "is this Pro or Starter" guesswork inside the component:

```ts
type Props =
  | { variant: "starter"; nextResetAt: Date }
  | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date };
```

Optional fallback: keep the old single-Date shape if Starter behavior is unchanged AND the pill never rendered for Pro before (it did, per Phase 3 — it rendered for any paid user). Migrate to the union to keep types tight.

### 2. Render logic

```tsx
if (props.variant === "starter") {
  return <Pill>Next batch · {daysFromNow(props.nextResetAt)}d</Pill>;
}

// Pro
if (props.batchesRemaining > 0) {
  return <Pill>{props.batchesRemaining} batches left</Pill>;
}
return <Pill>Resets in {daysFromNow(props.periodEndsAt)}d</Pill>;
```

`daysFromNow` is the existing client-side helper used today (or its renamed equivalent). Reuse, don't rewrite.

### 3. Preserve the hydration sentinel

The pill currently uses `useSyncExternalStore` with a mount sentinel to avoid SSR/CSR flash on the day-count string. Keep the same pattern for both branches. The pre-mount fallback for Pro under-cap can be the static `"{N} batches left"` (no day math) — that's already deterministic and won't flash.

### 4. Update `top-bar.tsx`

The topbar already reads `snapshot.plan`, `snapshot.nextResetAt`, and now `snapshot.proQuota`. Pass to the pill:

```tsx
{snapshot.plan === "pro" && snapshot.proQuota ? (
  <QuotaCountdownPill
    variant="pro"
    batchesRemaining={snapshot.proQuota.max - snapshot.proQuota.used}
    periodEndsAt={snapshot.proQuota.periodEndsAt}
  />
) : snapshot.plan === "starter" && snapshot.nextResetAt ? (
  <QuotaCountdownPill variant="starter" nextResetAt={snapshot.nextResetAt} />
) : null}
```

(Adjust to match the existing conditional — Pro overrides Starter; trial users still get no pill.)

### 5. Edge cases

- Pro under-cap with `batchesRemaining === 4` (just rolled over, zero batches used) → "4 batches left." Fine — natural copy.
- Pro at-cap with `periodEndsAt` already past `now` (rollover just happened on read) → guarded by the snapshot computation, which already returns `proQuota.used = 0` after rollover. Should not occur in practice.

## Acceptance Criteria

- [ ] Pill props are a discriminated union: `starter` or `pro`.
- [ ] Pro under-cap renders "{N} batches left".
- [ ] Pro at-cap renders "Resets in {N}d".
- [ ] Starter rendering is byte-for-byte identical to before.
- [ ] Hydration sentinel preserved; no SSR/CSR mismatch.
- [ ] `top-bar.tsx` passes the right props based on plan + snapshot.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The pill's visual style stays unchanged (champagne tint, small pill on the topbar). Phase 4 only changes the text inside it.
- Do not add an additional pill for the period end date when under-cap. Show ONE fact at a time per pill — that's the Phase 3 convention.
- A trial user does not render this pill; the existing `<TrialStrip />` handles trial. Do not change that.
