# Task 13: TopBar Trial Strip

## Status
not started

## Wave
1

## Description

Add a `<TrialStrip />` to `DashboardTopBar` that shows *"Pro trial — {N} days left."* when the user's subscription is in the `trial` status. Reads from existing `subscriptionService.checkSubscription(userId)` — no new service code.

## Dependencies

**Depends on:** None (uses existing `subscriptionService`, `auth`)
**Blocks:** task-14
**Context from dependencies:** `subscriptionService.checkSubscription(userId): Promise<SubscriptionStateSnapshot>` already exists. `SubscriptionStateSnapshot.status` includes `"trial"`. `SubscriptionStateSnapshot.daysLeftInTrial: number | null` exists.

## Files to Modify

- `src/components/dashboard/top-bar.tsx` — MODIFY (add `<TrialStrip />` somewhere in the existing layout)

## Implementation Steps

### 0. Investigate the current TopBar

Read `top-bar.tsx`. Identify:

- Where the existing plan label / user menu lives.
- Whether the component is a server component or client component.
- Where the subscription data is already loaded (if at all).

Two paths depending on what's there:

- **If the TopBar is a server component** that already reads subscription: add `<TrialStrip>` inline based on the subscription data already on hand.
- **If the TopBar is a client component**: receive `subscription` as a prop from a server-rendered parent (typically the `(onboarded)` layout). If the parent doesn't pass it, modify the parent to do so.

### 1. `<TrialStrip />` component

Either inline within `top-bar.tsx` or extract to `src/components/dashboard/trial-strip.tsx`. Keep it tiny:

```tsx
export function TrialStrip({ daysLeft }: { daysLeft: number }) {
  return (
    <div className="hidden sm:flex items-center gap-2 rounded-full bg-primary/15 border border-primary/30 px-3 py-1 text-xs">
      <Sparkles className="size-3 text-primary" />
      <span className="text-primary font-medium">
        Pro trial — {daysLeft} {daysLeft === 1 ? "day" : "days"} left
      </span>
    </div>
  );
}
```

- Use `<Sparkles>` icon from lucide-react (already used elsewhere in the dashboard).
- Hidden on mobile (`hidden sm:flex`) because the TopBar gets cramped at small widths and the `/create` page note already conveys the same info.

### 2. Wire it into TopBar

Render between the existing plan label and the user menu, only when:

```ts
subscription.status === "trial" && subscription.daysLeftInTrial !== null
```

Example placement (illustrative — adjust to existing layout):

```tsx
<div className="flex items-center gap-4">
  <PlanLabel ... />
  {subscription.status === "trial" && subscription.daysLeftInTrial !== null && (
    <TrialStrip daysLeft={subscription.daysLeftInTrial} />
  )}
  <UserMenu ... />
</div>
```

### 3. Visibility rules

- Visible on every `(onboarded)` page (dashboard, create, posts, settings, etc.)
- Hidden when `status !== "trial"` (e.g., `active`, `cancelled`, `expired`)
- Hidden when `daysLeftInTrial === null` (defensive — shouldn't happen if status is `trial`)
- Hidden on mobile (`hidden sm:flex`)

## Acceptance Criteria

- [ ] TopBar shows the trial strip when subscription.status === "trial" AND daysLeftInTrial !== null
- [ ] Strip is hidden on mobile (sm breakpoint)
- [ ] Strip hidden for `active`, `cancelled`, `expired` subscription statuses
- [ ] Copy switches between "day" / "days" correctly at 1 day
- [ ] `npm run lint`, `npm run typecheck` clean
- [ ] Visually verify in both themes (dark + light) — strip readable in both

## Notes

- The `daysLeftInTrial` value is computed at subscription-fetch time (server-side). A user who keeps the tab open for hours will see a stale count — that's accepted per spec § 12 risks.
- No CTA on the strip in Phase 2 (no upgrade flow yet). The link target would be `/pricing` which is a placeholder.
- This task is in Wave 1 — fully independent of schema changes or other Phase 2 work. Can be implemented and shipped in isolation.
