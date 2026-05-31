# Task 14: Onboarding Form — Starter Platform Cap

## Status
not started

## Wave
3

## Description

If a Starter user opens onboarding (rare in Phase 3 since paid plans are set via DB after onboarding), the platform-picker UI enforces max 2 of `{facebook, instagram, linkedin}`. Trial and Pro users keep the existing min-1-no-max behavior. The service-side enforcement from task-04 catches anything that slips past.

## Dependencies

**Depends on:** task-04 (`profileService.saveProfile` returns `PLATFORMS_OVERAGE_FOR_PLAN`)
**Blocks:** none
**Context from dependencies:** task-04 ensures the server-side check exists; this task adds matching client-side UX.

## Files to Modify

- `src/components/onboarding/onboarding-form.tsx` (modified) — read plan from props, conditionally cap platform selection
- `src/app/(app)/onboarding/page.tsx` (modified) — pass `subscription.plan` to the form

## Implementation Steps

### 1. Plan-aware prop

Add `plan: SubscriptionPlan` prop to `<OnboardingForm />`. The onboarding page already loads or can load the subscription via `checkSubscription`.

### 2. Picker constraint

The existing platform picker (multi-select toggle group from Phase 2 task-06) currently allows 1+ selections. Phase 3 addition:

- If `plan === "starter"` AND already 2 platforms checked AND user clicks an unchecked third:
  - Block the toggle.
  - Show inline error below the picker: "Starter plan covers 2 platforms. Uncheck one to switch."
- If `plan !== "starter"`: no max — keep current behavior.

### 3. Submit-time validation (defense in depth)

Form's existing Zod schema (in `onboarding/actions.ts`) accepts `platforms.length >= 1`. Phase 3 doesn't change the Zod schema — the service-layer enforcement (task-04) catches Starter overages. The form's max-cap is a UX nicety, not a correctness gate.

### 4. Map `PLATFORMS_OVERAGE_FOR_PLAN` error to field-level

If `saveOnboardingAction` returns the new error code from `profileService.saveProfile`:

```ts
return {
  ok: false,
  fieldErrors: {
    platforms: "Starter plan covers 2 platforms — uncheck one to continue.",
  },
};
```

The form renders this under the platform picker.

### 5. Edge case: profile already exists with 3 platforms, plan changes to Starter

This is settings-screen territory, not onboarding. Don't handle here — the gate fires on `/create`'s `<QuotaGatedScreen variant="overage" />` (task-07), which directs the user to settings to re-pick. Onboarding is only for fresh users.

## Acceptance Criteria

- [ ] Pro / trial user can still check all 3 platforms (no regression).
- [ ] Starter user can check at most 2; the third click is blocked with inline error copy.
- [ ] Server-side error `PLATFORMS_OVERAGE_FOR_PLAN` from `saveProfile` surfaces as a field-level error on the platforms picker.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- In Phase 3, Starter users almost never go through onboarding — onboarding runs once at signup, when everyone is `free_trial`. The cap is here mostly for completeness and for the rare future scenario where onboarding gets re-shown.
- Don't disable the third checkbox visually before the user clicks — that hides which platforms are available. Block on click + show error, matching the "explain what happened" pattern from DESIGN.md § 14.
- The block-on-click is preferable to silently auto-unchecking another platform; the user should explicitly choose which 2 they want.
