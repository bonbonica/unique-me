# Task 15: Security Pass + Lint/Typecheck/Build Audit

## Status
not started

## Wave
4

## Description

Phase 3 close-out audit. Mirror of Phase 2's task-14: lint / typecheck / build, ownership audit on extended service methods, server-action audit, plus Phase-3-specific manual tests (gate bypass attempts, setPlan exposure check, downgrade behavior).

## Dependencies

**Depends on:** task-01–14
**Blocks:** Phase 3 merge / push
**Context from dependencies:** All schema, service, action, UI changes in place.

## Files to Modify

- None for code (this is an audit). Issues found → fix in the originating task's files.

## Implementation Steps

### 1. Automated checks

```
npm run lint
npm run typecheck
npm run build:ci
```

All three must exit 0. The expected build:ci footprint: existing routes + (possibly) updated `/pricing` page if it gained a card layout — no new routes are expected from Phase 3.

### 2. Service-layer audit

For each new/extended method, verify ownership + return shape:

| Method | Check |
|---|---|
| `canGenerate(userId)` | userId is the only input; reads subscription / profile / batches all filtered by it. ✅ |
| `nextResetAt(userId)` | same ✅ |
| `setPlan(userId, plan)` | userId is server-supplied. ✅ |
| `saveProfile(userId, input)` | extended with plan check — still receives userId from session. ✅ |
| `generateWeekly(userId, { ..., postLength })` | userId from session. postLength validated as `PostLength` union. ✅ |

### 3. Server-action audit

`grep -r "setPlan" src/app/` — **must return zero results.** `setPlan` is dev/admin only and must never be wrapped in a server action.

For each modified action in `create/actions.ts`, `onboarding/actions.ts`:
- Session re-resolved.
- `session.user.id` is the only userId source.
- `postLength` (where applicable) validated as a string in `["short", "medium", "long"]` before being passed to the service.

### 4. `canGenerate` reason coverage test

Set up four users via Drizzle Studio + walk through each gate:

1. **Trial with batch** → `trial_batch_exists` (regression of Phase 2).
2. **Active Starter with recent batch** → `weekly_cap_active` with correct `nextResetAt`.
3. **Active Starter with 3 platforms** → `starter_platforms_overage` with `currentCount: 3`.
4. **Cancelled paid plan** → `plan_inactive`.

Each one renders the matching gated screen.

### 5. Plan-change-resets-quota test

1. Pro user, last batch 2 days ago → gate blocks.
2. `setPlan(userId, "starter")` via Drizzle Studio (or call the helper from a one-off script).
3. Same user → gate now allows. Generate succeeds.

### 6. Downgrade preserves in-flight batch

1. Pro user, batch in `scheduling` status.
2. Set `subscriptions.plan = "starter"` and `status = "active"` via Drizzle Studio.
3. Navigate to `/posts?batchId=...` → batch still loads, locked-summary still renders, edit still works.
4. Navigate to `/create` → gate behaves per new plan (Starter rules).

### 7. Trial pauses (D3) test

1. Trial user, no batch.
2. Wait until trial elapses (or shorten `TRIAL_DAYS` temporarily, then revert).
3. `/create` form still allows generating that one lifetime batch.
4. After the batch, `/create` shows trial-gated screen with the expired-copy variant.

### 8. Post-length round-trip

1. Pro user generates a batch with `postLength = "long"`.
2. Drizzle Studio shows `weekly_batches.post_length = "long"`.
3. Captions noticeably longer than a `short` batch generated separately.

### 9. Day labels

Generate a batch on a Wednesday. Wizard cards show:
- Day 1 · Wed
- Day 2 · Thu
- Day 3 · Fri
- Day 4 · Sat
- Day 5 · Sun
- Day 6 · Mon
- Day 7 · Tue

In your browser's timezone (test by temporarily changing OS timezone — labels should follow).

### 10. Definition of done

Walk through spec § 10 — every box ticked.

## Acceptance Criteria

- [ ] `npm run lint` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run build:ci` exits 0.
- [ ] `grep -r "setPlan" src/app/` returns zero results.
- [ ] All 4 `canGenerate` reasons reachable via Drizzle Studio state.
- [ ] Plan-change-resets-quota test passes.
- [ ] Downgrade-preserves-in-flight test passes.
- [ ] Trial-pauses test passes.
- [ ] Post-length end-to-end persists and reaches AI prompt.
- [ ] Day labels render correctly in user's timezone.
- [ ] Spec § 10 DoD: all items ticked or explicitly deferred with rationale.

## Notes

- Don't merge if any item fails. Fix in the originating task, re-run the audit.
- Phase 5 will land payments. Document any rate-limiting concern in `specs/phase-3-backlog.md` as a follow-up.
- Per AGENTS.md: "You are still accountable. Even if an agent wrote the code, you can't blame an agent for a security issue." This audit is the human-signoff gate.
