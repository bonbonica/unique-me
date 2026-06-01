# Task 17: Pricing Card — Pro Copy Verification

## Status
not started

## Wave
4

## Description

Verify the `/pricing` page surfaces the updated Pro copy from task 02. This is primarily a visual check — task 02 changes the source of truth in `src/lib/pricing.ts`. The pricing page reads `PLAN_DETAILS` already (Phase 3), so the page should pick up the new strings automatically.

**Important:** If the pricing card hardcodes any copy that should now come from `PLAN_DETAILS`, refactor here.

## Dependencies

**Depends on:** task-02 (updated `PLAN_DETAILS.pro`)
**Blocks:** task-19
**Context from dependencies:** task-02 updated `pitch` and `features[0]` for Pro.

## Files to Modify

- `src/app/pricing/page.tsx` (modified, possibly only by virtue of touching imports)
- Any pricing-card component if it has its own hardcoded copy (verify at task time)

## Implementation Steps

### 1. Open `src/app/pricing/page.tsx`

Confirm the Pro card reads `PLAN_DETAILS.pro.pitch` and `PLAN_DETAILS.pro.features` — not hardcoded literals.

If the card hardcodes "1 batch / week" or "1 batch per week" anywhere, replace with the `PLAN_DETAILS.pro` field. This is the only case where this task needs an actual code change.

### 2. Visual smoke

Run `pnpm dev`, open `/pricing`, confirm:

- Pro pitch reads: "4 batches per month, all platforms"
- Pro features bullet 1 reads: "4 batches / month"
- Pro features bullets 2 + 3 unchanged: "All 3 platforms (pick 1–3)", "Pick post length (short / medium / long)"
- Starter card unchanged (still "1 batch per week", "1 batch / week", etc.)
- Free trial card unchanged

Visual smoke in both dark and light themes (DESIGN.md).

### 3. Marketing copy elsewhere

Grep for any other copy that says "1 batch / week" or "1 batch per week" in marketing surfaces:

```
grep -ri "1 batch" src/app/ src/components/
```

Anything hardcoded that referred to Pro's old cadence should now read "4 batches / month". Anything referring to Starter (still 7-day) is unchanged.

## Acceptance Criteria

- [ ] `/pricing` Pro card pitch reads "4 batches per month, all platforms".
- [ ] `/pricing` Pro card feature bullet 1 reads "4 batches / month".
- [ ] Visual smoke confirms no stale "1 batch / week" copy on the Pro card.
- [ ] No hardcoded duplicate of the pricing strings remains in the pricing page or its card components.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- This task is small by design. The real change happens in task 02. This task ensures the change reaches the user.
- If anywhere in the codebase the pricing card duplicates the PLAN_DETAILS strings (e.g. a marketing landing page), file a follow-up to consolidate. Out of scope for Phase 4 unless it directly hides the change.
- The "Coming soon" CTA stays (Phase 3 D10). Phase 5 owns real billing.
