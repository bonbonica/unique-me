# Task 13: /settings — Plan Section

## Status
not started

## Wave
3

## Description

Add a new "Plan" section to `/settings` showing the user's current plan, status, and next-reset time (paid plans only). Read-only — no upgrade button in Phase 3. If a Starter user is in `starter_platforms_overage`, surface an inline error pointing to the platform selector.

## Dependencies

**Depends on:** task-02 (pricing constants), task-03 (`nextResetAt`, plan + status from snapshot)
**Blocks:** none
**Context from dependencies:** task-02 supplies `PLAN_DETAILS` + `formatMonthlyPrice`; task-03 provides snapshot + `nextResetAt`.

## Files to Modify

- `src/app/(app)/(onboarded)/settings/page.tsx` (modified) — add the Plan section
- `src/components/settings/plan-section.tsx` (new) — the section component

## Implementation Steps

### 1. Section component

```tsx
type Props = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  daysLeftInTrial: number | null;
  nextResetAt: Date | null;
  platformOverage: { count: number } | null;
};

export function PlanSection({ ... }: Props) {
  // Card with:
  // - Plan label + monthly price (or "Free / 7 days" for trial)
  // - Status badge (trial / active / cancelled / expired)
  // - Days left in trial OR next-reset countdown (paid only)
  // - Inline overage error if platformOverage is non-null
}
```

### 2. Layout inside card

```
┌─────────────────────────────────────────┐
│ Your plan                               │  Fraunces text-xl
│                                          │
│ Pro                          $19.99/mo  │  large, two-col split
│ Active                                  │  badge below plan label
│                                          │
│ Next batch ready Friday, in 3 days      │  paid-only line, muted
│                                          │
│ [Optional] Inline overage warning:      │
│ "Starter covers 2 platforms — you've    │
│  picked 3. Update your platforms below."│
└─────────────────────────────────────────┘
```

Style per design system: `bg-card rounded-2xl p-8 shadow-soft`.

### 3. Read-only

No buttons. No upgrade. The link to `/pricing` from elsewhere covers the "I want to upgrade" intent; Settings just SHOWS state.

### 4. Page wiring

In `settings/page.tsx`, server-side:

```ts
const subscription = await checkSubscription(session.user.id);
const next = await nextResetAt(session.user.id);
const profile = await profileService.getProfile(session.user.id);
const platformOverage = subscription.plan === "starter" && profile.platforms.length > 2
  ? { count: profile.platforms.length }
  : null;

<PlanSection
  plan={subscription.plan}
  status={subscription.status}
  daysLeftInTrial={subscription.daysLeftInTrial}
  nextResetAt={next.at}
  platformOverage={platformOverage}
/>
```

### 5. Placement on page

Top of the settings page, above existing sections. Generous space-y between sections (`space-y-12`).

## Acceptance Criteria

- [ ] Trial user: section shows "Free trial · 7 days · {N} days left".
- [ ] Active Starter user: section shows "Starter · $9.99/mo · Active · Next batch in {N} days, on {Weekday}".
- [ ] Active Pro user: same shape with Pro / $19.99/mo.
- [ ] Cancelled / expired paid user: shows status accurately, no "next batch" line.
- [ ] Starter user with 3 platforms: inline overage warning visible.
- [ ] No upgrade buttons. No "Subscribe" CTAs.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The "Next batch ready {Weekday}, in {N} days" line is the in-app reminder's secondary home — the primary is the dashboard banner (task-10). Match copy tone.
- If the existing `/settings` page has no other sections yet, build the placeholder out enough that the Plan section doesn't look orphaned.
- Days-left countdown uses the same client-component trick as the banner (`useMemo` over `Date.now()`).
