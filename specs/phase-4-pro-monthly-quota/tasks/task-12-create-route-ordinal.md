# Task 12: /create Route — Ordinal + postCount Resolution

## Status
not started

## Wave
3

## Description

Compute the Pro batch ordinal + `postCount` server-side in the `/create` action and pass them into `postService.generateWeekly`.

- For Pro: ordinal = (Pro batches already in current period) + 1; `postCount = ordinal === 4 ? 9 : 7`.
- For Starter / Trial: `postCount: 7`, `batchOrdinalInPeriod: null`.

Also: extend the page-level `canGenerate` switch to handle the new `monthly_cap_active` reason (the actual gate-screen rendering lands in task 13, but the switch arm goes here so the page compiles after Wave 3).

## Dependencies

**Depends on:** task-04 (canGenerate returns `monthly_cap_active`), task-06 (snapshot has `proQuota`), task-10 (`generateWeekly` accepts new fields)
**Blocks:** task-13 (gate-screen variant rendering), task-18 (downstream surfaces iterate `totalPosts`)
**Context from dependencies:** Tasks 04, 06, 10 provide the data + new input shape; this task is the wiring at the route boundary.

## Files to Modify

- `src/app/(app)/(onboarded)/create/actions.ts` (modified) — compute ordinal + `postCount`, pass to service
- `src/app/(app)/(onboarded)/create/page.tsx` (modified) — add `monthly_cap_active` case to the gate switch (renders a placeholder until task 13 fills in the variant)

## Implementation Steps

### 1. Compute ordinal in the action

In `create/actions.ts`, the existing handler calls `subscriptionService.canGenerate` (or reads it from the page) and then calls `postService.generateWeekly`. Insert the ordinal computation between those steps.

```ts
import { computeProBatchOrdinal } from "@/lib/services/subscription-service";

// inside the action, after the gate passes:
const snapshot = await subscriptionService.checkSubscription(session.user.id);

const batchOrdinalInPeriod =
  snapshot.plan === "pro" && snapshot.proQuota
    ? snapshot.proQuota.used + 1
    : null;

const postCount: 7 | 9 =
  batchOrdinalInPeriod === 4 ? 9 : 7;

const result = await postService.generateWeekly(session.user.id, {
  theme: input.theme,
  importantThing: input.importantThing,
  postLength: input.postLength,
  postCount,
  batchOrdinalInPeriod,
});
```

Notes:
- `snapshot.proQuota.used` is the count BEFORE this batch is inserted, so `used + 1` is the new batch's ordinal.
- `batchOrdinalInPeriod === 4` is the only path to `postCount: 9` — all other Pro and non-Pro paths yield 7.
- Trial / Starter rows get `batchOrdinalInPeriod: null` and `postCount: 7`, matching their unchanged behavior.

### 2. Race-condition guard

Between the snapshot read and the INSERT, a parallel tab could also try to generate. The gate check inside `postService.generateWeekly` re-evaluates `canGenerate` immediately before the insert (Phase 2/3 pattern). The ordinal computation here uses the snapshot's count, which could be one off if a sibling request inserted in the meantime.

This is acceptable: the worst case is two Pro batches collide on ordinal 1 (both think they're first). The downstream COUNT-based gate in `canGenerate` will block the SECOND attempt — assuming the database serializes them — but the ordinal column might mis-record. To make this robust:

- Inside `postService.generateWeekly`, AFTER passing the gate but BEFORE the insert, **recompute** ordinal as `(count of existing Pro batches in current period) + 1` using the same helper. This belongs inside `generateWeekly` (task 10), not here. **File a follow-up task** if task 10 didn't bake this in.

For Phase 4 Section A, the route-level computation is sufficient given low concurrency expectations. Document the race in the action's comments.

### 3. Add the new case to the gate switch

In `create/page.tsx`:

```tsx
case "monthly_cap_active":
  return (
    <QuotaGatedScreen
      variant="monthly_quota"
      nextResetAt={gate.nextResetAt}
      batchesUsed={gate.batchesUsed}
    />
  );
```

The component does NOT yet support `variant="monthly_quota"` — that lands in task 13. Until task 13 ships, this line will type-error. That is intentional: it forces task 13 to ship as part of the same wave / PR.

Alternative if you need a green build between tasks: temporarily render the existing `variant="quota"` shape — but track this so it's converted before task 13's PR merges.

## Acceptance Criteria

- [ ] `create/actions.ts` computes `batchOrdinalInPeriod` server-side based on the Pro snapshot.
- [ ] `postCount` is `9` if and only if the new batch's ordinal is `4`; otherwise `7`.
- [ ] Trial / Starter calls pass `batchOrdinalInPeriod: null`, `postCount: 7`.
- [ ] `create/page.tsx` has a `case "monthly_cap_active":` arm in the gate switch.
- [ ] After tasks 10 + 11 + 12 + 13 land: a Pro user can create 4 batches; batch 4 has 9 posts; batch 5 attempt is gated with `monthly_cap_active`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The ordinal-recomputation inside `generateWeekly` (the race guard) is a "do it once, do it right" defensive measure. If task 10 didn't add it, do so now or file a follow-up.
- Do NOT cache the snapshot at module level — server actions run per request and the snapshot is per user.
- Pro batch 4 is the ONLY 9-post batch. There is no batch 5. The spec is strict: 4 batches per period, full stop.
- A future refactor could move the ordinal/`postCount` derivation into a shared helper exported from `subscription-service.ts` so the page server component (which doesn't currently call the action's path) can also derive it for display purposes. Defer that polish.
