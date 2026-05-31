# Task 02: Pricing Constants Module

## Status
not started

## Wave
1

## Description

Create `src/lib/pricing.ts` — typed, single-source-of-truth constants for the 3 plans and their monthly prices. UI tasks (07 / 12 / 13) all read from here so a future price change is a one-file edit. Phase 5 will extend this module with annual pricing + Polar product IDs.

## Dependencies

**Depends on:** none
**Blocks:** task-07 (gated screens reference plan labels), task-12 (pricing page reads everything), task-13 (settings shows current plan label + price)
**Context from dependencies:** N/A — foundation task.

## Files to Modify

- `src/lib/pricing.ts` (new)
- `src/components/dashboard/top-bar.tsx` (modified) — remove local `PLAN_LABELS`, import from `pricing.ts`

## Implementation Steps

1. Create `src/lib/pricing.ts` with these exports:

   ```ts
   import type { SubscriptionPlan } from "@/lib/schema";

   export type PlanDetails = {
     label: string;
     monthlyPriceUsd: number;          // 0 sentinel = render as "Free"
     pitch: string;                     // one-line marketing line
     features: readonly string[];       // bullet list for /pricing cards
   };

   export const PLAN_DETAILS: Record<SubscriptionPlan, PlanDetails> = {
     free_trial: { ... },
     starter:    { ... },
     pro:        { ... },
   };

   export const PLAN_LABELS: Record<SubscriptionPlan, string> = { ... };

   export function formatMonthlyPrice(plan: SubscriptionPlan): string { ... }
   ```

2. Locked values (per spec D2):

   | Plan | Label | Monthly | Pitch | Features |
   |---|---|---|---|---|
   | `free_trial` | Free trial | 0 | "Full Pro features, 7 days" | "1 batch lifetime"; "All 3 platforms"; "Pick post length"; "No card required" |
   | `starter` | Starter | 9.99 | "1 batch per week" | "1 batch / week"; "2 of 3 platforms"; "All edit + regenerate features" |
   | `pro` | Pro | 19.99 | "1 batch per week, all platforms" | "1 batch / week"; "All 3 platforms (pick 1–3)"; "Pick post length (short / medium / long)" |

3. `formatMonthlyPrice` returns `"Free"` when `monthlyPriceUsd === 0`, else `` `$${price.toFixed(2)}/mo` ``.

4. Refactor `src/components/dashboard/top-bar.tsx`:
   - Delete the local `const PLAN_LABELS = { ... }`.
   - `import { PLAN_LABELS } from "@/lib/pricing";`.
   - Other behavior unchanged.

## Acceptance Criteria

- [ ] `src/lib/pricing.ts` exports `PLAN_DETAILS`, `PLAN_LABELS`, `formatMonthlyPrice`, and `PlanDetails` type.
- [ ] Top-bar refactored: no literal "Free trial" / "Starter" / "Pro" / "$9.99" / "$19.99" string in `top-bar.tsx`.
- [ ] `npm run lint` and `npm run typecheck` exit 0.
- [ ] `npm run build:ci` exits 0.

## Notes

- Monthly-only by design — annual pricing arrives with payments in Phase 5. Don't add `annualPriceUsd` fields preemptively.
- Don't import this module into the schema or service layer; it's a UI-side module only. Pricing strings have no business in `canGenerate` or `postService`.
- Phase 5 will add a sibling `PolarProductIds` constant next to `PLAN_DETAILS` — keeping pricing isolated to one file makes that addition trivial.
