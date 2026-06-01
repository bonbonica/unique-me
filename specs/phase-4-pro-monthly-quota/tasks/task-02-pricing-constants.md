# Task 02: Pricing Constants + Pro Copy

## Status
not started

## Wave
1

## Description

Add Phase 4 quota constants and update the Pro plan's display copy in `src/lib/pricing.ts`. Starter and free_trial details are **unchanged** (D-A5, D-A6).

New constants:
- `MAX_BATCHES_PER_PERIOD = 4`
- `ROLLING_PERIOD_DAYS = 30`
- `STANDARD_BATCH_POSTS = 7`
- `PRO_LONG_BATCH_POSTS = 9`

Pro copy changes:
- `PLAN_DETAILS.pro.pitch`: `"1 batch per week, all platforms"` → `"4 batches per month, all platforms"`
- `PLAN_DETAILS.pro.features[0]`: `"1 batch / week"` → `"4 batches / month"`

## Dependencies

**Depends on:** none
**Blocks:** task-13 (gate screen reads pricing copy), task-17 (pricing card verifies copy)
**Context from dependencies:** N/A — foundation task.

## Files to Modify

- `src/lib/pricing.ts` (modified)

## Implementation Steps

1. Open `src/lib/pricing.ts`. Locate the export section near the top.
2. Add the four new constants (typed `as const` where appropriate):
   ```ts
   export const MAX_BATCHES_PER_PERIOD = 4;
   export const ROLLING_PERIOD_DAYS = 30;
   export const STANDARD_BATCH_POSTS = 7;
   export const PRO_LONG_BATCH_POSTS = 9;
   ```
   Group these together under a comment explaining "Phase 4 Pro monthly quota — see specs/phase-4-pro-monthly-quota/spec.md § 1."
3. In the `PLAN_DETAILS` object, update the `pro` entry:
   ```ts
   pro: {
     label: "Pro",
     pitch: "4 batches per month, all platforms",
     features: [
       "4 batches / month",
       "All 3 platforms (pick 1–3)",
       "Pick post length (short / medium / long)",
     ],
   },
   ```
   **Do not change** the `free_trial` or `starter` entries.
4. Verify TypeScript: `pnpm typecheck` should exit 0 — no type contract changes here.

## Acceptance Criteria

- [ ] Four new constants exported with the values above.
- [ ] `PLAN_DETAILS.pro.pitch` reads `"4 batches per month, all platforms"`.
- [ ] `PLAN_DETAILS.pro.features[0]` reads `"4 batches / month"`.
- [ ] `PLAN_DETAILS.starter` and `PLAN_DETAILS.free_trial` are byte-for-byte identical to their previous state.
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- The `STANDARD_BATCH_POSTS` and `PRO_LONG_BATCH_POSTS` constants are read by Wave 3 tasks (the create route, postService). Defining them centrally now lets those tasks import a name rather than scatter `7` / `9` literals.
- Do NOT add a `PRO_LONG_BATCH_DAYS` constant separately — the "9-day" framing is a presentation detail; the contract is post count (1 post per day, per D-A4a).
- Tone check: pitches follow `DESIGN.md` § 14 voice — no exclamation points, plain confident verbs. "4 batches per month, all platforms" complies.
