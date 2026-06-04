# Task 10: QuotaCountdownPill — re-anchor Pro on `scheduledBatchCount`

## Status
not started

## Wave
3

## Description

Per D-S2-10, Pro's pill `batchesRemaining` derives from `scheduledBatchCount` (`weekly_batches.status IN ('scheduling', 'completed')` for the signed-in user), not the prior `batchesUsedThisPeriod` count. Cancelled and reviewing batches on `/create` no longer eat a pill slot. Starter is unchanged (its cap is 1/period — there's no rolling-4 concept). Trial is unchanged (static labels). The pill's rendered copy stays exactly as Stage-1 (`{N} batches left` / `Resets in Nd`) — only the *counting basis* feeding `batchesRemaining` changes.

The component itself is mostly a pass-through change; the real work is at the call site in the topbar, which now sources Pro's remaining count from the snapshot's new `scheduledBatchCount` field that task-02 added to `ScheduledView` / the subscription snapshot.

## Dependencies

**Depends on:** task-02 (extended snapshot exposes `scheduledBatchCount` — without that field, this task has nothing to re-anchor on).
**Blocks:** none.
**Parallel with:** task-07, task-08, task-09 (different files).

## Files to Modify

- `src/components/dashboard/quota-countdown-pill.tsx` — comment-only update; the prop union is already the right shape (`{ variant: "pro"; batchesRemaining: number; periodEndsAt: Date }`). Refresh the Pro branch's docblock to reflect the new counting basis.
- `src/components/dashboard/top-bar.tsx` (or wherever the topbar constructs `<QuotaCountdownPill />` for Pro users) — replace the `batchesUsedThisPeriod`-style derivation with `scheduledBatchCount`.

## Implementation Steps

### 1. Verify the snapshot field

Task-02's extension of `subscriptionService.checkSubscription` / `getProQuotaState` (or whatever helper feeds the topbar) should now return a `scheduledBatchCount: number` field on the Pro snapshot. Confirm the field is present and typed before wiring the pill:

```ts
// Should compile cleanly:
const snap = await subscriptionService.checkSubscription(userId);
if (snap.plan === "pro") {
  const n: number = snap.proQuota.scheduledBatchCount; // or wherever task-02 puts it
}
```

If task-02 nested the field elsewhere (e.g. directly on the `subscription` row, or returned via a separate `postService.getScheduledBatchCount(userId)` helper), use that — pick the source task-02 lands and stick to it.

### 2. Topbar caller — Pro branch only

Locate the existing Pro branch in the topbar. Stage-1 / Phase-4 form (paraphrased — verify locally):

```ts
// pro
const proQuota = subscription.proQuota!;
pillProps = {
  variant: "pro",
  batchesRemaining: Math.max(0, proQuota.max - proQuota.used),  // OLD basis
  periodEndsAt: proQuota.periodEndsAt,
};
```

Re-anchor `batchesRemaining` on `scheduledBatchCount`. Cap at 4 (per D-S2-10):

```ts
// pro
const proQuota = subscription.proQuota!;
const scheduledBatchCount = proQuota.scheduledBatchCount;  // from task-02
pillProps = {
  variant: "pro",
  batchesRemaining: Math.max(0, 4 - scheduledBatchCount),
  periodEndsAt: proQuota.periodEndsAt,
};
```

`Math.max(0, …)` defends against the rare race where eviction lags behind a successful schedule and the count momentarily reads 5 — the pill should show `Resets in Nd`, not `-1 batches left`.

### 3. Starter + Trial branches — untouched

Per D-S2-10:

> Trial pill unchanged from Stage-1 D-S12.

> Starter remains `1 - batchesUsedThisPeriod` (unchanged — Starter doesn't have a rolling-4 concept; their cap is 1/period).

Do not edit those two branches. Leave the existing `subscription.plan === "free_trial"` and `subscription.plan === "starter"` derivations alone.

### 4. Component docblock refresh (no logic change)

In `quota-countdown-pill.tsx`, the Pro branch of the file-level docblock currently reads (paraphrased):

```
- **Pro** (Phase 4 D-A12 / D-A14 + Scheduled redesign D-S11) —
  `batchesRemaining > 0` → `"{N} batches left"` … `batchesRemaining === 0`
  → `"Resets in {N}d"` against the rolling 30-day period end.
```

Update only the source-of-truth sentence — keep the rendering description identical, just append the new anchoring basis:

```
- **Pro** (Phase 4 D-A12 / D-A14 + Scheduled redesign D-S11 + Stage-2 D-S2-10) —
  `batchesRemaining > 0` → `"{N} batches left"` (singular `"1 batch left"`
  when N=1, deterministic, no sentinel). `batchesRemaining === 0` →
  `"Resets in {N}d"` against the rolling 30-day period end.
  As of Stage-2, `batchesRemaining = 4 - scheduledBatchCount` where
  `scheduledBatchCount` counts only `weekly_batches.status IN ('scheduling',
  'completed')`. Cancelled and reviewing batches on `/create` no longer
  deduct.
```

No JSX change, no prop union change. The component is already shaped correctly.

### 5. Rendered copy is unchanged

Per spec: "Pill copy unchanged from Stage-1 (`N batches left` / `Resets in Nd`) — only the counting basis changes." Do not adjust:

- The `noun = batchesRemaining === 1 ? "batch" : "batches"` inflection.
- The `Resets in {N}d` countdown label.
- The hydration sentinel.
- The `Pill` chrome.

## Acceptance Criteria

- [ ] Pro user with 0 batches in `scheduling`/`completed` (including users who only have `reviewing` or `cancelled` batches on `/create`) sees `4 batches left`.
- [ ] Pro user with 1 → `3 batches left`. 2 → `2 batches left`. 3 → `1 batch left` (singular). 4 → `Resets in Nd`.
- [ ] A Pro user who creates a batch (now `reviewing`) and immediately cancels it (now `cancelled`) sees pill stay at `4 batches left` — neither status deducts.
- [ ] Starter pill unchanged: still `1 batch left` / `Resets in Nd` keyed off the existing weekly-period helper.
- [ ] Trial pill unchanged: still `Trial · 1 batch` / `Trial used · Upgrade` (Link to `/pricing`).
- [ ] Component-level prop union unchanged (`{ variant: "pro"; batchesRemaining: number; periodEndsAt: Date }`).
- [ ] Docblock annotates the new D-S2-10 basis on the Pro branch.
- [ ] `Math.max(0, 4 - scheduledBatchCount)` guards against transient over-cap states.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The rolling-4 counting basis (D-S2-1) is `scheduling + completed`, NOT `scheduling + completed + reviewing + cancelled`. The whole point of Stage-2 is that the wall between "things on `/create`" and "things on `/schedule`" maps 1:1 to "doesn't eat a slot" vs "eats a slot". This task is the topbar surface of that contract — if the pill ever shows `3 batches left` for a Pro user with 1 cancelled card on `/create`, that's the regression to catch.
- DESIGN.md §14 voice: the singular/plural inflection (`1 batch left` vs `2 batches left`) is English grammar, not just a styling choice — keep it for the cap-edge case where a Pro user is one Schedule away from `Resets in Nd`.
- Acceptance can be verified manually by creating + cancelling a batch on a test Pro account, OR via a unit test on the topbar's pill-prop derivation if a test harness exists.

## Out of scope

- Pro `monthly_quota` gate copy on `/create` (`<QuotaGatedScreen variant="monthly_quota" />`). Stage-2 doesn't change that surface's copy — only the pill re-anchors. The gated screen's `nextResetAt` math is the same as Phase 4 / Stage-1.
- Visual treatment of the pill (colour, border, glow). Pill chrome unchanged.
- Real-time updates. The pill still doesn't auto-tick — refreshing the page re-reads the snapshot. Pro user cancels a batch on `/schedule/[batchId]` → on next `/create` (or full-page navigation), the pill rises by 1.
- Trial / Starter re-anchoring. Spec explicitly excludes them from the new basis.
- Any change to `subscriptionService` shape — that's task-02. This task only consumes whatever field task-02 exposes.
