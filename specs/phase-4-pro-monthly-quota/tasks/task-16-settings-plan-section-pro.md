# Task 16: PlanSection — Pro Period Usage Line

## Status
not started

## Wave
4

## Description

Add a Pro-specific line under the plan/status display in `<PlanSection />`:

> {used} of 4 batches used this period · Resets {Weekday, Date}

For Trial and Starter, the section stays exactly as today.

## Dependencies

**Depends on:** task-06 (`snapshot.proQuota` provides used + periodEndsAt)
**Blocks:** task-19
**Context from dependencies:** task-06 provides the data; this task is pure display.

## Files to Modify

- `src/components/settings/plan-section.tsx` (modified)
- `src/app/(app)/(onboarded)/settings/page.tsx` (modified) — pass `proQuota` to the section if not already

## Implementation Steps

### 1. Extend the component's props

Add `proQuota: { used: number; max: 4; periodEndsAt: Date } | null` to the props shape. Mirror the snapshot's exact type so passing is mechanical.

### 2. Render the Pro line

In the section body, after the existing "Next batch ready {weekday}" line that Phase 3 added for paid users, add:

```tsx
{props.plan === "pro" && props.proQuota && (
  <p className="text-sm text-muted-foreground leading-7">
    {props.proQuota.used} of {props.proQuota.max} batches used this period
    {" · Resets "}
    <ResetDate at={props.proQuota.periodEndsAt} />
  </p>
)}
```

`<ResetDate />` is the same client-side helper used by the gate screen / banner — reuse, don't duplicate.

### 3. Suppress the legacy weekly-cap line for Pro

Phase 3 added a "Next batch ready {weekday}, in {N} days" line for any active paid user with `nextResetAt`. For Pro users, that line carries the SAME date as the new "Resets {date}" line. Either:

- Remove the Phase 3 line for Pro users (keep it for Starter), OR
- Keep both — but then the Pro section reads redundantly.

**Decision: suppress the Phase 3 line for Pro.** Pro shows the new usage line; Starter shows the original line.

```tsx
{props.plan === "starter" && props.nextResetAt && (
  <p>Next batch ready {weekday}, in {days} days.</p>
)}
{props.plan === "pro" && props.proQuota && (
  <p>{used} of 4 batches used this period · Resets {date}.</p>
)}
```

### 4. Update `settings/page.tsx`

Pass `proQuota={subscription.proQuota}` to `<PlanSection />`. If `<PlanSection />` already takes the full snapshot, no change is needed.

## Acceptance Criteria

- [ ] Active Pro users see "{used} of 4 batches used this period · Resets {Weekday, Date}".
- [ ] Active Starter users see the original "Next batch ready {weekday}, in {N} days." line (regression check).
- [ ] Trial users see no quota line — only trial countdown (regression check).
- [ ] Inactive paid users (cancelled/expired) see no quota line (regression check).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The Pro line is intentionally lower-priority typographically (`text-sm`, muted-foreground). The plan name + price stays the visual focus.
- Singular/plural for "batches" — "1 of 4 batch used" is awkward; default to "batches" for the plural even at 0/1. Phase 4 sample copy follows this convention.
- The "this period" framing is intentional — rolling 30 days is not a calendar month but users will read it close enough. If user research later objects, the copy can change without service changes.
