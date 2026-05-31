# Task 11: TopBar Countdown — Extend for Paid Users

## Status
not started

## Wave
3

## Description

Extend `<DashboardTopBar />` so paid users in the `weekly_cap_active` state see a small countdown next to the plan pill: "Next batch · 3d". Trial users continue to see the existing `<TrialStrip />`. The placeholder "7 posts ready this week" string gets removed.

## Dependencies

**Depends on:** task-03 (reads `nextResetAt`)
**Blocks:** none
**Context from dependencies:** task-03 provides `nextResetAt(userId)`.

## Files to Modify

- `src/components/dashboard/top-bar.tsx` (modified) — branch on subscription state, remove placeholder
- `src/components/dashboard/quota-countdown-pill.tsx` (new) — small client component for the countdown

## Implementation Steps

### 1. Remove the placeholder

Delete the existing `<span className="text-xs text-muted-foreground">7 posts ready this week</span>` block. The Phase 1 comment marking it as a stub can also be removed.

### 2. Add `<QuotaCountdownPill />`

```tsx
"use client";

import { useMemo } from "react";

export function QuotaCountdownPill({ nextResetAt }: { nextResetAt: Date }) {
  const daysLeft = useMemo(() => {
    return Math.max(
      0,
      Math.ceil((nextResetAt.getTime() - Date.now()) / 86_400_000)
    );
  }, [nextResetAt]);

  return (
    <div className="hidden sm:flex items-center gap-2 rounded-full bg-muted border border-border px-3 py-1 text-xs">
      <span className="text-muted-foreground font-medium">
        Next batch · {daysLeft}d
      </span>
    </div>
  );
}
```

### 3. TopBar branching

The TopBar already receives `subscription: SubscriptionStateSnapshot`. Phase 3 needs the next-reset value too. Two options:

- **Option A** (cleaner): widen the `SubscriptionStateSnapshot` type returned by `checkSubscription` to include `nextResetAt: Date | null`, computed inside `checkSubscription`. Then no extra prop / query at render time.
- **Option B** (less coupling): pass `nextResetAt` as a separate prop, computed at the layout level by calling `subscriptionService.nextResetAt(userId)` alongside `checkSubscription`.

Pick **Option A** — fewer DB calls, snapshot stays the unified surface. Update `checkSubscription` (in task-03 scope, retro-bump if needed) OR layer `nextResetAt` computation into the TopBar's parent layout.

### 4. Branching inside TopBar

```tsx
{subscription.status === "trial" && subscription.daysLeftInTrial !== null ? (
  <TrialStrip daysLeft={subscription.daysLeftInTrial} />
) : null}

{subscription.status === "active" && subscription.nextResetAt !== null ? (
  <QuotaCountdownPill nextResetAt={subscription.nextResetAt} />
) : null}
```

Never render both — trial state and active state are mutually exclusive.

### 5. Style match

`<QuotaCountdownPill />` uses muted styling (not champagne) — it's a status indicator, not a focal pill. The plan pill itself is the champagne accent; the countdown shouldn't compete with it.

## Acceptance Criteria

- [ ] Trial user → only `<TrialStrip />` visible, no countdown pill.
- [ ] Active paid user within 7d window → `<QuotaCountdownPill />` shows "Next batch · {N}d".
- [ ] Active paid user with no prior batch OR >7d elapsed → no countdown pill.
- [ ] Cancelled/expired paid user → no countdown pill (the plan pill alone signals the state).
- [ ] No "7 posts ready this week" string anywhere in the codebase (grep confirms).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The TopBar hides on mobile (`md:flex`); the pill inherits that. No mobile-specific layout needed.
- If Option A widens `SubscriptionStateSnapshot`, update task-03's acceptance criteria too: the snapshot must include `nextResetAt`.
- Don't auto-tick the countdown (same rationale as task-10).
