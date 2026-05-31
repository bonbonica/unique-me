# Task 07: /create Page — Plan-Aware Gate Branches + QuotaGatedScreen

## Status
not started

## Wave
3

## Description

Extend `/create` to handle paid-user gate states alongside the existing trial gate. Add a new `<QuotaGatedScreen />` component that renders for paid users in three sub-states: `weekly_cap_active`, `starter_platforms_overage`, `plan_inactive`. The trial-gated branch from Phase 2 is unchanged.

## Dependencies

**Depends on:** task-02 (pricing constants for plan labels), task-03 (`canGenerate` returns the 4-reason union), task-04 (profileService enforces Starter cap server-side)
**Blocks:** task-08 (form picker renders inside this page)
**Context from dependencies:** task-03 provides the new `weekly_cap_active`, `starter_platforms_overage`, `plan_inactive` reasons; task-02 gives `PLAN_LABELS` and `formatMonthlyPrice`.

## Files to Modify

- `src/app/(app)/(onboarded)/create/page.tsx` (modified) — add paid-quota + overage + inactive branches
- `src/components/create/quota-gated-screen.tsx` (new) — paid-user gated UI

## Implementation Steps

1. In `create/page.tsx`, after the existing trial check, call `subscriptionService.canGenerate(session.user.id)`. Switch on the result:

   - `{ allowed: true }` → existing form-mode render path (unchanged).
   - `{ allowed: false, reason: "trial_batch_exists" }` → existing `<TrialGatedScreen />` (unchanged path; this branch can't actually fire here because the explicit trial-check earlier in the page already returns; keeping the case for exhaustiveness).
   - `{ allowed: false, reason: "weekly_cap_active", nextResetAt }` → `<QuotaGatedScreen variant="quota" nextResetAt={nextResetAt} />`.
   - `{ allowed: false, reason: "starter_platforms_overage", currentCount }` → `<QuotaGatedScreen variant="overage" currentCount={currentCount} />`.
   - `{ allowed: false, reason: "plan_inactive" }` → `<QuotaGatedScreen variant="inactive" />`.

2. Create `<QuotaGatedScreen variant="quota" | "overage" | "inactive" {...payload} />`:

   - **`quota`** (default copy):
     > **Your next batch unlocks in {N} days, on {Weekday}.**
     > Your weekly cycle resets 7 days after your last batch was created.
     > [Return to your current batch →] — deep-link to `/posts`.
     > Compute N + weekday client-side from `nextResetAt` via `Intl.DateTimeFormat`. Render server-side first; the client component swaps in the user's local timezone (one-frame flash is acceptable, see spec § 9).

   - **`overage`**:
     > **Your Starter plan covers 2 of the 3 platforms you've picked.**
     > Update your profile to choose two. You've picked {currentCount}.
     > [Update profile →] — link to `/settings`.

   - **`inactive`**:
     > **Your subscription isn't active.**
     > Pick a plan to keep generating posts.
     > [See plans →] — link to `/pricing`.

3. All three variants share the same outer card layout — same `max-w-md mx-auto` pattern as `<TrialGatedScreen />`, same headline + body + CTA shape. The only thing that changes is copy + CTA target.

4. Use design-system tokens from `DESIGN.md`: champagne CTA pill, ivory body, Fraunces headline `text-3xl sm:text-4xl tracking-tight`.

## Acceptance Criteria

- [ ] Paid user with no batch → form renders (unchanged path).
- [ ] Paid user with recent batch (within 7d, no plan change) → `quota` variant renders with correct days-remaining + weekday.
- [ ] Starter user with `profile.platforms.length === 3` → `overage` variant renders with `currentCount: 3`.
- [ ] Cancelled/expired paid user → `inactive` variant renders.
- [ ] Trial user with batch → existing `<TrialGatedScreen />` (regression check, not new).
- [ ] All three variants pass the design-system check (champagne CTA, generous padding, no exclamation points in copy).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The page already does the trial branch FIRST (before calling `canGenerate`). That's intentional — the existing `<TrialGatedScreen />` has cancelled-recoverable nuances that the new component doesn't replicate. Don't merge them.
- The `nextResetAt` value flows from the server-rendered page into the client component as an ISO string; the client component constructs `new Date(...)` and computes the display. Don't try to format on the server (timezone is wrong there).
- "No exclamation points in microcopy" (DESIGN.md § 14). The copy above already complies; double-check during implementation.
