# Task 04: QuotaCountdownPill — Trial variant + unified copy

## Status
not started

## Wave
2

## Description

Extend `<QuotaCountdownPill />` to handle Trial users and unify the under-cap / at-cap copy across all three plans. Trial gets honest, non-resetting copy (`"Trial · 1 batch"` → `"Trial used · Upgrade"`); Starter and Pro share `"N batches left"` / `"Resets in Nd"`. The Trial-used pill is wrapped in `<Link href="/pricing">`.

## Dependencies

**Depends on:** none.
**Blocks:** task-07 (the topbar caller passes the correct variant for the Create Posts hub), task-12 (audit).
**Parallel with:** task-03 (different file).

## Files to Modify

- `src/components/dashboard/quota-countdown-pill.tsx` (modified) — extend prop union and rendering.
- `src/components/dashboard/top-bar.tsx` (modified, if it constructs the pill props) — pass the new Trial variant when `plan === "free_trial"`.

## Implementation Steps

### 1. Extend the discriminated-union prop type

Replace the existing `Props` type:

```ts
type Props =
  | { variant: "trial"; used: boolean }
  | { variant: "starter"; batchesRemaining: number; nextResetAt: Date | null }
  | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date };
```

Old Starter shape was `{ variant: "starter"; nextResetAt: Date }`. The new shape unifies Starter under-cap (`batchesRemaining > 0`) and at-cap (`batchesRemaining === 0 && nextResetAt`) so the component branches the same way Pro does.

### 2. Update the entry switch

```tsx
export function QuotaCountdownPill(props: Props) {
  if (props.variant === "trial") {
    if (props.used) {
      return (
        <Link href="/pricing" className="no-underline">
          <Pill label="Trial used · Upgrade" />
        </Link>
      );
    }
    return <Pill label="Trial · 1 batch" />;
  }

  if (props.batchesRemaining > 0) {
    const noun = props.batchesRemaining === 1 ? "batch" : "batches";
    return <Pill label={`${props.batchesRemaining} ${noun} left`} />;
  }

  // At cap — both Starter and Pro use the same `Resets in Nd` countdown.
  return <CountdownPill {...props} />;
}
```

### 3. Update `<CountdownPill />`

Old function signature handled only Starter `nextResetAt` + Pro `periodEndsAt`. New shape:

```tsx
function CountdownPill(
  props:
    | { variant: "starter"; batchesRemaining: 0; nextResetAt: Date | null }
    | { variant: "pro"; batchesRemaining: 0; periodEndsAt: Date },
) {
  const mounted = useHasMounted();
  const target =
    props.variant === "starter" ? props.nextResetAt : props.periodEndsAt;
  if (target === null) {
    return <Pill label="Resets soon" />;
  }
  const label = mounted
    ? `Resets in ${computeDaysLeft(target)}d`
    : "Resets soon";
  return <Pill label={label} />;
}
```

Starter under-cap that has never generated a batch passes `nextResetAt: null` per the existing `no_batch_yet` contract — fall through to `"Resets soon"`. (This case is rare; under-cap renders via the deterministic branch above.)

### 4. Singular vs plural

`batchesRemaining === 1` → `"1 batch left"`. `>= 2` → `"N batches left"`. Per English; per DESIGN.md voice (§14 — no exclamation, plain confident copy).

### 5. Wire up the topbar caller

In `top-bar.tsx` (or wherever `<QuotaCountdownPill />` is constructed):

```ts
const plan = subscription.plan;
let pillProps: ComponentProps<typeof QuotaCountdownPill>;

if (plan === "free_trial") {
  // "used" = any batch exists (any status), per D-S12.
  const hasBatch = await postService.userHasAnyBatch(userId);
  pillProps = { variant: "trial", used: hasBatch };
} else if (plan === "starter") {
  const used = await postService.countBatchesInPeriod(userId);  // existing helper
  const batchesRemaining = Math.max(0, 1 - used);
  pillProps = {
    variant: "starter",
    batchesRemaining,
    nextResetAt: subscription.nextResetAt,
  };
} else {
  // pro
  const proQuota = subscription.proQuota!;
  pillProps = {
    variant: "pro",
    batchesRemaining: Math.max(0, proQuota.max - proQuota.used),
    periodEndsAt: proQuota.periodEndsAt,
  };
}

return <QuotaCountdownPill {...pillProps} />;
```

If existing helpers don't exist under those exact names (`userHasAnyBatch`, `countBatchesInPeriod`), use the closest equivalents already in `post-service.ts` or `subscription-service.ts`. `postService.getMostRecentBatch(userId)` returning non-null = "has any batch" — that already exists.

### 6. Hydration & cache preservation

Keep `useHasMounted` and the `Pill` wrapper exactly as-is. Wrap the Trial-used `Pill` in `<Link>` — `<Link>` renders consistently SSR vs CSR, no sentinel needed for the Trial branch (the label is static; the link is too).

### 7. Pricing route

`/pricing` already exists. Confirm the link href stays `/pricing` (not `/pricing/upgrade` or similar). Per Phase 4 task-17 the Pro card on `/pricing` is the upgrade target for Trial users.

## Acceptance Criteria

- [ ] New `Props` discriminated union covers all three plans.
- [ ] Trial + no batch → renders `"Trial · 1 batch"`.
- [ ] Trial + any batch (any status, including cancelled) → renders `<Link href="/pricing">` wrapping `"Trial used · Upgrade"`.
- [ ] Starter + 1 batch left → renders `"1 batch left"`.
- [ ] Starter + 0 batches left → renders `"Resets in Nd"`.
- [ ] Pro + N batches left → renders `"N batches left"` (singular `"1 batch left"` when N=1).
- [ ] Pro + 0 batches left → renders `"Resets in Nd"`.
- [ ] No exclamation points (DESIGN.md §14).
- [ ] Trial-used pill is keyboard-focusable as a link with visible focus ring.
- [ ] Existing `useSyncExternalStore` hydration sentinel preserved for the at-cap countdown branches.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- DESIGN.md §14 voice check: `"Trial used · Upgrade"` is honest, not negative. `"Upgrade"` is a confident verb (cf. "Generate," "Review"). No exclamation. Middle dot separator matches the existing Starter pill (`"Next batch · Nd"`).
- The Trial pill is the single primary place users see the upgrade nudge from the topbar. Other surfaces (banner, settings, gated screen) cover this differently and are unchanged.
- The `nextResetAt: Date | null` shape on the Starter prop is unusual but matches Phase 3's existing `no_batch_yet` contract. Don't refactor that here.

## Out of scope

- Changes to `<TrialStrip />` (the separate trial-days-remaining strip).
- Changes to the dashboard banner or `<PlanSection />` settings copy.
- Pro under-cap warning state (e.g., "1 batch left" styling change). The visual treatment is the same as 4 / 3 / 2.
- Animated transitions between pill variants.
