# Task 19: Security Pass + Lint/Typecheck/Build Audit

## Status
not started

## Wave
5

## Description

Phase 4 close-out audit. Mirrors Phase 3 task-15 with the additional Phase 4 invariants:

- `setPlan` still NOT exported from any server action.
- `period_start_date` mutation restricted to migration `0006` and `setPlan` (D-A18).
- Pro 4-batch cap behaves correctly under cancellation, downgrade, and rollover.
- `regenerate` is length-aware (D-A17).
- Vitest suite green.

## Dependencies

**Depends on:** tasks 01–18
**Blocks:** task-20 (manual E2E follows the automated audit), Phase 4 merge / push
**Context from dependencies:** All schema, service, generator, action, UI changes in place.

## Files to Modify

- None for code (this is an audit). Issues found → fix in the originating task's files.

## Implementation Steps

### 1. Automated checks

```
pnpm lint
pnpm typecheck
pnpm build:ci
pnpm test
```

All four must exit 0. `pnpm test` runs the Vitest parity + rollover suite from task 08.

### 2. Service-layer audit

For each new/extended method:

| Method | Check |
|---|---|
| `canGenerate(userId)` | userId is the only input; reads subscription / profile / batches all filtered by it. Pro branch uses `getProQuotaState`. ✅ |
| `nextResetAt(userId)` | same; shares `getProQuotaState` with `canGenerate`. ✅ |
| `checkSubscription(userId)` | snapshot includes `proQuota`; only populated for active Pro. ✅ |
| `setPlan(userId, plan)` | userId is server-supplied. Pro upgrade sets `periodStartDate`. ✅ |
| `generateWeekly(userId, { ..., postCount, batchOrdinalInPeriod })` | userId from session. postCount validated as `7 \| 9` union. ✅ |
| `regenerate(...)` | reads batch row, narrows `totalPosts` to `7 \| 9` before passing to generator. ✅ |

### 3. Server-action audit

```
grep -rn "setPlan" src/app/
```

**Must return zero results.** `setPlan` is dev/admin only and must never be wrapped in a server action.

```
grep -rn "periodStartDate" src/app/
grep -rn "period_start_date" src/app/
```

Only READ access permitted (e.g. logging, display in admin panels). Any UPDATE / INSERT against this column outside the service layer is a defect.

```
grep -rn "batchOrdinalInPeriod" src/app/
```

Should appear only in `create/actions.ts` where the ordinal is computed and passed into `generateWeekly`. No direct DB writes from the route layer.

### 4. `canGenerate` reason coverage test

Set up four users via Drizzle Studio + walk through each gate:

1. **Trial with batch** → `trial_batch_exists` (regression of Phase 2/3).
2. **Active Starter with recent batch** → `weekly_cap_active` with correct `nextResetAt` (regression of Phase 3).
3. **Active Starter with 3 platforms** → `starter_platforms_overage` with `currentCount: 3` (regression).
4. **Active Pro with 4 batches in current period** → `monthly_cap_active` with correct `nextResetAt` and `batchesUsed: 4` (new).
5. **Cancelled paid plan** → `plan_inactive` (regression).

Each renders the matching gated screen.

### 5. Pro 4-batch cap

1. Seed a fresh Pro user via Drizzle Studio: `plan="pro"`, `status="active"`, `periodStartDate=now()`, `planChangedAt=now()`.
2. Create 4 batches back-to-back via `/create`. **No 7-day wait.** Batch 4 has 9 posts. Confirm via Drizzle Studio: `total_posts: 9`, `batch_ordinal_in_period: 4`.
3. Attempt batch 5 → blocked with `monthly_cap_active`. Gate screen shows correct next-reset date.

### 6. Rollover without write

1. Note the `period_start_date` value on the seeded Pro user.
2. Edit `period_start_date` to a date 35 days ago.
3. Call any page that hits `canGenerate` (e.g. `/dashboard`).
4. Confirm `period_start_date` in the DB is **unchanged** — pure JS rollover did not persist (D-A11).
5. Confirm the user is now under-cap with 0 batches in the current period (the "old" batches are outside the rolled-forward window).

### 7. Cancelled-batch-counts-for-Pro

1. Pro user with 3 batches.
2. Cancel one batch via the wizard.
3. Create a 4th batch.
4. Attempt a 5th → blocked. Cancelled batch counts (D-A16).

### 8. Downgrade preserves in-flight

1. Pro user with batch in `scheduling` status, batches_used = 2.
2. `setPlan(userId, "starter")` via Drizzle Studio script.
3. Navigate to `/posts?batchId=...` → batch still loads, edit still works.
4. Navigate to `/create` → gate behaves per Starter rules (7-day wait if last batch < 7d ago).
5. `period_start_date` row left intact (harmless; Starter doesn't read it).

### 9. Upgrade Starter → Pro

1. Starter user with 1 batch from 2 days ago. Pre-change: weekly_cap_active.
2. `setPlan(userId, "pro")`.
3. Confirm `period_start_date` AND `plan_changed_at` are both set to ~now.
4. Navigate to `/create` → allowed. `proQuota.used = 0` (the pre-Pro batch doesn't count because `planChangedAt > lastBatch.createdAt` — D-A13).

### 10. Regenerate on 9-post batch

1. Pro user, batch 4 (9 posts) in `reviewing` status.
2. Open post 7 → regenerate.
3. Returns a valid post (manual sanity check of the copy).
4. No tool-schema errors or Zod validation failures in the server logs.

### 11. UI surfaces

- `/create` gate screen shows `monthly_quota` variant correctly.
- Topbar pill shows "{N} batches left" / "Resets in Nd" for Pro.
- Dashboard banner shows "{used} of 4 batches used".
- Settings shows "{used} of 4 used · Resets {date}".
- Pricing card shows "4 batches / month".
- All 4 work in both dark and light themes.

### 12. Definition of done

Walk through spec § 10 — every box ticked.

## Acceptance Criteria

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm build:ci` exits 0.
- [ ] `pnpm test` exits 0 with all task-08 cases green.
- [ ] `grep -r "setPlan" src/app/` returns zero results.
- [ ] `grep -r "periodStartDate\|period_start_date" src/app/` returns only read access.
- [ ] All 5 `canGenerate` reasons reachable via Drizzle Studio state.
- [ ] Pro 4-batch cap + 9-post batch 4 verified.
- [ ] Rollover-without-write verified.
- [ ] Cancelled-batch-counts verified for Pro.
- [ ] Downgrade-preserves-in-flight verified.
- [ ] Upgrade Starter → Pro semantics verified.
- [ ] Regenerate on 9-post batch verified.
- [ ] UI surfaces sanity-checked in both themes.
- [ ] Spec § 10 DoD: all items ticked or explicitly deferred with rationale.

## Notes

- Don't merge if any item fails. Fix in the originating task, re-run the audit.
- Phase 5 lands payments. Document any rate-limiting concern in `specs/phase-4-backlog.md` (or equivalent) as a follow-up.
- Per AGENTS.md: "You are still accountable. Even if an agent wrote the code, you can't blame an agent for a security issue." This audit is the human-signoff gate.
- The "test" command here runs the Vitest suite — if it ever depends on external resources (DB, network), document those in the test file header so CI can replicate.
