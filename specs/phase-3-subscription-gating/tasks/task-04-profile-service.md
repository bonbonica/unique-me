# Task 04: profileService — Starter Platform-Cap Enforcement

## Status
not started

## Wave
2

## Description

When a Starter user saves or updates their profile, enforce the 2-platform cap (D6). Trial and Pro users are unaffected. The enforcement happens at the service layer so it's defensive against any UI bypass; the onboarding form (task-14) also enforces visually, but the service is the source of truth.

## Dependencies

**Depends on:** none (works against existing `profiles.platforms` column)
**Blocks:** task-07 (`canGenerate` overage branch surfaces through `/create`), task-14 (onboarding form invokes the same validation path)
**Context from dependencies:** N/A.

## Files to Modify

- `src/lib/services/profile-service.ts` (modified) — add plan-aware validation to `saveProfile` (and `updatePlatforms` if it exists separately)

## Implementation Steps

1. Read the current `saveProfile` signature + return shape. It already validates `platforms.length >= 1`. Add a new branch:
   - Before the DB write, load the user's subscription via `subscriptionService.getSubscription(userId)` (or `checkSubscription` — pick whichever already exists and is cheap).
   - If `subscription.plan === "starter"` AND `input.platforms.length > 2`:
     - Return the existing error shape (mirror how `saveProfile` reports invalid input today — likely thrown sentinel `"INVALID_INPUT"` or a `{ ok: false, error }` discriminator depending on the current code).
     - Error code: `"PLATFORMS_OVERAGE_FOR_PLAN"`.

2. If there's a separate `updatePlatforms(userId, platforms)` method, apply the same check there.

3. Add a JSDoc paragraph above the check explaining why service-layer enforcement matters: the UI cap is convenience, the service cap is correctness — a downgrade from Pro→Starter doesn't auto-trim platforms, so the gate has to refuse the save.

4. Import cycle concern: `profileService` already imports from `subscriptionService` in some flows (or vice versa). If a cycle appears, query `subscriptions` directly via Drizzle — same escape hatch as task-03.

## Acceptance Criteria

- [ ] Starter user attempting to save a profile with 3 platforms gets a `"PLATFORMS_OVERAGE_FOR_PLAN"` error (or whatever shape matches the existing API surface).
- [ ] Starter user saving a profile with 1 or 2 platforms succeeds.
- [ ] Pro and trial users are unaffected — can still save 1, 2, or 3 platforms.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The error code lives in profileService's error union — don't surface it through `canGenerate`; that's a separate concern (canGenerate has its own `starter_platforms_overage` reason for the OTHER direction: when the user already has 3 platforms and is now on Starter trying to generate).
- The cap is *2 of {facebook, instagram, linkedin}*, not 2 of any arbitrary platform set. Don't add new Phase 3 platforms — those land in later phases (X / Twitter, etc.).
- The check is plan-driven, not status-driven. A cancelled Starter user with 2 platforms shouldn't be blocked from saving — the gate is only "is this user's plan = starter" at save time.
