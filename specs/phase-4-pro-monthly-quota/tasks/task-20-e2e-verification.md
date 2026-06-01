# Task 20: Manual E2E Verification + verification.md

## Status
not started

## Wave
5

## Description

Document the full Pro user journey in a new `specs/phase-4-pro-monthly-quota/verification.md` file. The doc is the human runbook for verifying the phase ships correctly. It complements (does not replace) task 19's automated audit.

The verification covers the Pro happy path (4 batches no-wait → 9-post batch 4 → at-cap gate → rollover), edge cases (cancellation counts, downgrade preserves, upgrade fresh-anchors), and the visual surfaces.

## Dependencies

**Depends on:** task-19 (automated checks have passed)
**Blocks:** Phase 4 merge
**Context from dependencies:** Code-level audit is done; this task is the human walk-through.

## Files to Modify

- `specs/phase-4-pro-monthly-quota/verification.md` (new)

## Implementation Steps

### 1. Write `verification.md`

Structure:

```markdown
# Phase 4 Section A — Manual E2E Verification

## Prerequisites
- Local dev server: `pnpm dev`
- Drizzle Studio open: `pnpm db:studio`
- A clean test user (sign up fresh or wipe an existing one)

## Steps

### 1. Seed a Pro user
- In Drizzle Studio, find the test user's `subscriptions` row.
- Set: plan="pro", status="active", periodStartDate=<now>, planChangedAt=<now>.
- Confirm via `/settings` → "Pro" pitch visible.

### 2. Pro happy path — 4 batches no-wait
- Navigate to /create.
- Fill theme + importantThing, post length "medium", Generate.
- After redirect to /posts/:batchId, confirm 7 posts.
- Navigate back to /create — gate is OPEN (no 7-day wait).
- Repeat for batches 2 and 3 (also 7 posts).
- For batch 4: fill the form, Generate. Confirm 9 posts in /posts/:batchId.
- Check Drizzle Studio: batch 4 row has total_posts=9, batch_ordinal_in_period=4.

### 3. At-cap gate
- Navigate to /create after batch 4.
- Confirm <QuotaGatedScreen variant="monthly_quota" /> renders.
- Copy: "You've used all 4 batches this period."
- Reset date shown as a future date (≤30 days from periodStartDate).

### 4. UI surfaces at-cap
- /dashboard banner: "4 of 4 batches used · Next reset in N days."
- Topbar pill: "Resets in Nd".
- /settings plan section: "4 of 4 batches used this period · Resets {date}".
- /pricing Pro card: "4 batches / month" + "4 batches per month, all platforms".

### 5. Rollover
- In Drizzle Studio, set the test user's periodStartDate to 35 days ago.
- Refresh /dashboard. Banner switches to "allowed" / "Ready when you are."
- Topbar pill: "4 batches left".
- /create gate: OPEN.
- Verify periodStartDate in DB is STILL 35 days ago (no write on read).

### 6. Cancelled batches count
- Reset state: fresh Pro user, periodStartDate=now.
- Generate 3 batches.
- Cancel one batch via the wizard.
- Generate a 4th batch — succeeds (counter = 4 including cancelled).
- Attempt a 5th — gate blocks.

### 7. Downgrade preserves in-flight
- Pro user with batch in "scheduling" status, 2 batches used.
- In Drizzle Studio: set plan="starter".
- Navigate to /posts/:batchId — batch loads, edits work.
- Navigate to /create — gate now uses Starter 7-day rule.
- periodStartDate column in DB is unchanged (intentional).

### 8. Upgrade Starter → Pro
- Starter user with 1 batch from 2 days ago. /create gate: weekly_cap_active.
- Run `setPlan(userId, "pro")` via a one-off script or direct UPDATE in Drizzle Studio.
- Drizzle Studio shows periodStartDate = now, planChangedAt = now.
- /create gate: OPEN. proQuota.used = 0 (planChangedAt > lastBatch.createdAt rule).

### 9. Regenerate on 9-post batch
- Pro user, batch 4 in "reviewing" status.
- Open post 7, hit Regenerate, provide feedback.
- New copy returns; no AI / Zod errors in server logs.

### 10. Theme + DESIGN.md visuals
- Toggle dark / light themes. Confirm all new surfaces render correctly in both.
- Champagne CTA on gate screen has correct hover glow.
- No exclamation points in any new microcopy.

## Sign-off

- [ ] All 10 steps green.
- [ ] No DB write to period_start_date observed in step 5.
- [ ] No regressions in Starter / Trial flows (run a quick smoke on a Starter user).
- [ ] Reviewer signature: ____
- [ ] Date: ____
```

### 2. Run the verification yourself

Walk every step. Fix any defect in the originating task's files. Re-run after every fix.

### 3. Update Phase 4 README

Mark the relevant DoD items in `spec.md § 10` based on what passed.

## Acceptance Criteria

- [ ] `specs/phase-4-pro-monthly-quota/verification.md` exists with the structure above.
- [ ] All 10 verification steps executed and signed off.
- [ ] Spec § 10 DoD reflects the verified state.
- [ ] No outstanding defects.

## Notes

- This task is the final human gate before merging Phase 4. Do not skip.
- If a step fails, do not patch around it in `verification.md` — fix the originating task's code and re-verify the failed step + adjacent ones.
- The verification doc lives alongside the spec so future phases can reference it as a baseline.
- For the rollover step, be precise about the date math — set `periodStartDate` to exactly 35 days ago in UTC; browser timezone may shift the displayed day count by 1 but the DB anchor stays.
- The 9-post batch is the only structural difference between Pro and Starter user-facing surfaces. Pay extra attention to wizard navigation ("Step 8 of 9"), day labels ("Day 9 · {weekday}"), and locked summary count.
