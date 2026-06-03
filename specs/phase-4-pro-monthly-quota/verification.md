# Phase 4 Section A — Manual E2E Verification

Runbook for human-verifying the Pro monthly-quota feature ships correctly.
Complements `task-19` (automated audits) — does NOT replace it.

## Prerequisites

- Local dev server running: `pnpm dev`
- Drizzle Studio open: `pnpm db:studio`
- A clean test user — sign up fresh, or wipe an existing user's `weekly_batches` and reset their `subscriptions` row.

Keep both the browser tab and Drizzle Studio side by side. Several steps verify
that values in the DB **do not change** when the UI re-reads them.

## Steps

### 1. Seed a Pro user

- In Drizzle Studio, open the test user's `subscriptions` row.
- Set:
  - `plan = "pro"`
  - `status = "active"`
  - `period_start_date = <now>` (round to the current minute is fine)
  - `plan_changed_at = <now>`
- Navigate to `/settings` and confirm the Pro plan section renders.
- Navigate to `/pricing` and confirm the Pro card shows "4 batches / month".

### 2. Pro happy path — 4 batches no-wait

- Navigate to `/create`. Gate should be OPEN (no countdown).
- Fill `theme` + `importantThing`, leave post length on "medium", click Generate.
- After redirect to `/posts?batchId=...`, confirm **7 posts**.
- Navigate back to `/create` — **no 7-day wait**. Gate stays OPEN.
- Repeat for batches 2 and 3 (each 7 posts). Each time return to `/create` immediately and confirm the gate is still open.
- For batch 4: Generate. Confirm **9 posts** in `/posts?batchId=...`. Wizard "Step X of 9" and the day-9 label should render correctly.
- Check Drizzle Studio: batch 4 row has `total_posts = 9`, `batch_ordinal_in_period = 4`. Batches 1–3 have `total_posts = 7` and `batch_ordinal_in_period = 1, 2, 3`.

### 3. At-cap gate

- Navigate to `/create` after batch 4.
- Confirm `<QuotaGatedScreen variant="monthly_quota" />` renders.
- Copy contains: "You've used all 4 batches this period."
- Reset date shown is a future date (≤ 30 days from `period_start_date`).
- "Return to your current batch" CTA deep-links to `/posts`.

### 4. UI surfaces at-cap

- `/dashboard` banner: "4 of 4 batches used · Next reset in N days." (no CTA at cap)
- Topbar pill: "Resets in Nd".
- `/settings` plan section: "4 of 4 batches used this period · Resets {date}".
- `/pricing` Pro card: "4 batches / month" feature line + "4 batches per month, all platforms" pitch.
- Toggle dark / light themes — every surface renders correctly in both.

### 5. Rollover without write

- In Drizzle Studio, edit the test user's `period_start_date` to **35 days ago** in UTC. Note the exact value before changing.
- Refresh `/dashboard`. Banner switches to the "allowed / ready when you are" Pro-under-cap state.
- Topbar pill: "4 batches left".
- `/create` gate: OPEN.
- **Verify `period_start_date` in the DB is still exactly 35 days ago.** Pure JS rollover did NOT write back (D-A11). This is the load-bearing security invariant of the phase — if the column changed, the rollover code is wrong.

### 6. Cancelled batches count

- Reset state: fresh Pro user, `period_start_date = now`, `plan_changed_at = now`. Wipe `weekly_batches` for this user in Drizzle Studio.
- Generate 3 batches.
- Cancel one batch via the wizard ("Stop entire batch").
- Generate a 4th batch — succeeds (the counter sees 4 including the cancelled one). Confirm it lands as `batch_ordinal_in_period = 4` and `total_posts = 9`.
- Attempt a 5th — gate blocks with `monthly_cap_active` (D-A16).

### 7. Downgrade preserves in-flight

- Pro user with a batch in `scheduling` status and `batches_used = 2`.
- In Drizzle Studio, set `subscriptions.plan = "starter"` and `subscriptions.plan_changed_at = <now>`. Leave `period_start_date` untouched.
- Navigate to `/posts?batchId=<the scheduling batch>` — batch still loads, edits still work.
- Navigate to `/create` — gate now uses Starter 7-day rule (the last batch was within 7 days, so `weekly_cap_active` fires).
- Confirm `period_start_date` column in the DB is unchanged. Harmless ballast for Starter (it doesn't read the column).

### 8. Upgrade Starter → Pro

- Starter user with 1 batch from 2 days ago. `/create` gate: `weekly_cap_active`.
- In Drizzle Studio (or via a one-off script), run the equivalent of `setPlan(userId, "pro")`:
  - `plan = "pro"`
  - `status = "active"`
  - `plan_changed_at = <now>`
  - `period_start_date = <now>`
- `/create` gate: OPEN. `proQuota.used = 0` because the Starter batch predates `plan_changed_at` (D-A13).
- Banner / pill / settings all show 0 used, 4 remaining.

### 9. Regenerate on 9-post batch

- Pro user with batch 4 (9 posts) in `reviewing` status.
- Open post 7, click Regenerate, provide feedback text.
- New copy returns within ~10s. Manual sanity check that it reads like a sensible post for the theme.
- Server logs: no `Zod` validation failures, no `tool schema` errors, no `length(7)`-vs-9 mismatches. (D-A17 — `regenerate` reads `batch.totalPosts` and forwards it to the generator.)

### 10. Theme + DESIGN.md visuals

- Toggle dark / light themes. Walk every new surface (gate screen, pill, banner, settings line, pricing card, day labels).
- Champagne CTA on the gate screen has the correct hover glow in dark mode; brass primary in light mode.
- No exclamation points in any new microcopy (DESIGN.md § 14).
- No double-period at the end of any banner / gate sentence.

## Smoke regressions (non-Pro plans)

Run a quick pass on a Starter and a Trial user to confirm Phase 3 surfaces are untouched:

- Starter user with a recent batch: `weekly_cap_active` gate renders the original Phase 3 7-day copy (not the monthly copy).
- Trial user with one existing batch: `trial_batch_exists` gate renders the original lifetime-1 copy.

## Sign-off

- [ ] All 10 steps executed and green
- [ ] No DB write to `period_start_date` observed in step 5
- [ ] No regressions in Starter / Trial flows (smoke pass run)
- [ ] DoD in `spec.md § 10` reconciled — every box ticked or explicitly deferred with rationale below

### Deferred / accepted limitations

_(Fill in anything that did not run end-to-end and the reason.)_

- Reviewer: ____________________
- Date: ____________________
