# Task 13: E2E verification

## Status
not started

## Wave
5

## Description

Manual end-to-end walkthrough at `http://localhost:3000`. Covers every plan × batch-state combination plus the dormant-variant smoke render. Produces `specs/scheduled-and-create-redesign/verification.md` as the artifact.

This is the human-eyes gate before merging the spec's implementation.

## Dependencies

**Depends on:** task-12 (all quality gates pass).
**Blocks:** none.

## Files to Modify

- `specs/scheduled-and-create-redesign/verification.md` (new) — the runbook + results.

## Implementation Steps

### 1. Local setup

```bash
# Terminal 1
docker compose up -d

# Terminal 2
pnpm dev
```

Open `http://localhost:3000` in the browser. Use a fresh Postgres or a known-good fixture user.

### 2. Sidebar audit

- [ ] Open any dashboard route. Sidebar items in order: **Create Posts**, **Image Library**, **Scheduled**, **Settings**. No "My Posts".
- [ ] Mobile drawer (≤ md): same four items.
- [ ] Click each item — all route correctly.

### 3. Top pill — Trial user, no batch

Use a fresh Trial user.

- [ ] Pill reads exactly: `Trial · 1 batch`.
- [ ] Pill is not a link (no underline on hover).

### 4. Top pill — Trial user, after generating

Generate one batch as the Trial user, leave it in `reviewing`.

- [ ] Pill reads exactly: `Trial used · Upgrade`.
- [ ] Pill is a link — hover shows focus affordance.
- [ ] Clicking navigates to `/pricing`.

### 5. Top pill — Trial user, after cancelling that batch

Cancel the batch (via `/posts` → schedule → cancel from `/schedule`).

- [ ] Pill still reads `Trial used · Upgrade` (cancelled counts).
- [ ] Still links to `/pricing`.

### 6. Top pill — Starter

- [ ] Fresh Starter (no batch): `1 batch left`.
- [ ] Starter with batch in `reviewing`: `0 batches left` is suppressed in favor of `Resets in Nd`.
- [ ] Starter at cap (any non-cancelled batch in window): `Resets in Nd` where N is reasonable.

### 7. Top pill — Pro

Set the user to Pro via Drizzle Studio (`subscriptions.plan = "pro"`, `period_start_date = now()`).

- [ ] Fresh Pro: `4 batches left`.
- [ ] After 1 batch: `3 batches left`.
- [ ] After 3 batches: `1 batch left` (singular).
- [ ] After 4 batches: `Resets in Nd`.

### 8. Create Posts hub — fresh state (0 unscheduled)

Trial user with no batch, or Pro with 4 batches all scheduled.

- [ ] `<UnscheduledBatchList />` does NOT render.
- [ ] `<GenerateForm />` (or gated screen) renders directly under the header.
- [ ] Header reads `"Create Posts"` (Fraunces).

### 9. Create Posts hub — 1+ unscheduled

Trial or Pro with 1+ batches in `reviewing` or `cancelled`.

- [ ] `[Start new batch]` and `[See scheduled posts →]` buttons visible at top.
- [ ] Cards stack below.
- [ ] Cards render correct state chips: `IN REVIEW` (champagne) for reviewing; `CANCELLED — re-schedule` (amber) for cancelled.
- [ ] Each card shows theme, importantThing (truncated to 1 line), per-network counts (FB/IG/LI + total).
- [ ] `[Open →]` navigates to `/posts?batchId={id}` and lands in the correct wizard mode.
- [ ] Form is collapsed by default.

### 10. Create Posts hub — at-cap state

Pro with 4 batches used.

- [ ] `[Start new batch]` button is disabled with tooltip `"You've used all batches this period."`
- [ ] `<QuotaGatedScreen variant="monthly_quota">` (or current Phase-4 equivalent) renders below the cards.
- [ ] `[See scheduled posts →]` still works.

### 11. Scheduled page — empty state

User with no `scheduling` or `completed` batches.

- [ ] Header reads `"Scheduled"`.
- [ ] Body: `"You don't have any scheduled batches yet."` + `[Start a new batch →]` button linking to `/create`.

### 12. Scheduled page — current period batches

Manually advance a batch to `status='scheduling'` (via wizard "Schedule" button or Drizzle Studio).

- [ ] Page renders one `<ScheduledBatchBox />` per `scheduling` batch.
- [ ] Pro batches show `BATCH 1 · UPCOMING`, `BATCH 2 · UPCOMING`, ... using the stored ordinal.
- [ ] Trial/Starter batches show `BATCH · UPCOMING` (no number).
- [ ] Box variant is **blue** (`bg-primary/15`). No emerald.
- [ ] Body shows theme + importantThing + FB/IG/LI counts + `N posts`.
- [ ] `[Cancel batch]` button visible.

### 13. Cancel batch flow

Click `[Cancel batch]` on a box.

- [ ] Dialog title: `Cancel batch` (Fraunces).
- [ ] Body: `"All 7 posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule."` (number matches `totalPosts`).
- [ ] No split block (because `alreadyPostedCount === 0` in Stage-1).
- [ ] Buttons: `[Keep batch]` (ghost), `[Cancel 7 posts]` (destructive, warm coral).
- [ ] Confirm → success toast `"Batch cancelled — returned to Create Posts."`.
- [ ] Box disappears from Scheduled.
- [ ] Navigate to `/create` → cancelled batch appears as `CANCELLED — re-schedule` card.
- [ ] Repeat from the cancelled card via the wizard's reschedule flow → batch returns to `/schedule`.

### 14. Cancel-already-cancelled race

Open two tabs. Both on `/schedule`. Both click `[Cancel batch]` on the same box. First confirms → success. Second confirms → error toast `"This batch was already cancelled."`. Page refreshes; box is gone.

### 15. Past Batches disclosure

Two cases:

a. **Stage-1 normal — empty disclosure**
- [ ] Disclosure trigger renders as `▸ Past batches (0)` (closed by default).
- [ ] Click trigger → reveals `"No finished batches in this period."`
- [ ] Trigger flips to `▾` chevron.

b. **Future / forced data — populated**

If task-09 was tested with a `completed` batch row inserted manually:
- [ ] Trigger reads `▸ Past batches (N)`.
- [ ] Opened body shows compact rows: `Mon Day  theme  N posts ✓`.
- [ ] Rows sorted ASC (oldest first).

### 16. Dormant variant smoke (currently_posting emerald box)

Temporarily render `<ScheduledBatchBox derivedState="currently_posting" ... />` either:
- via a temporary dev route (`src/app/dev/scheduled-box-preview/page.tsx`), OR
- by manually editing `getScheduledViewForUser()` to return `derivedState: "currently_posting"` for one row.

- [ ] Header strip is emerald (`bg-emerald-500/15 text-emerald-300`).
- [ ] Label reads `BATCH N · CURRENTLY POSTING` (or `BATCH · CURRENTLY POSTING` for Trial/Starter).
- [ ] Other box anatomy (theme, counts, total, Cancel button) renders identically to the blue variant.
- [ ] Cancel button still works — opens the dialog.

**Revert the temporary edit after capturing a screenshot in `verification.md`.**

### 17. Visual + voice spot-checks

- [ ] No exclamation points anywhere on the redesigned pages (DESIGN.md §14).
- [ ] All Lucide icons render at stroke-width 1.5.
- [ ] Card hover effect: `shadow-soft` → `shadow-lift` + `-translate-y-0.5` per DESIGN.md §11.
- [ ] Dark + light mode both render correctly. Trial-used pill is legible in both.
- [ ] Mobile (≤ sm): cards stack, buttons wrap, no clipping.

### 18. Write `verification.md`

Compile findings into `specs/scheduled-and-create-redesign/verification.md`:

```
# Verification — Scheduled & Create Posts Redesign

Date: YYYY-MM-DD
Tester: <name>
Branch: <branch>
Commit: <sha>

## Walkthrough results

### Sidebar audit — PASS / FAIL
- [ ] ... (copy criteria from this task, check off)

### Top pill — Trial — PASS / FAIL
...

(continue through every section above)

### Dormant emerald variant — screenshot

![currently-posting box](./img/currently-posting-box.png)

## Outstanding issues
- (none) OR a numbered list with file paths + reproduction steps
```

If any criterion fails, open a follow-up task in `specs/scheduled-and-create-redesign/tasks/` and link it.

## Acceptance Criteria

- [ ] Every checkbox in this task is verified PASS in `verification.md`.
- [ ] The dormant emerald variant screenshot is captured and stored under `specs/scheduled-and-create-redesign/img/`.
- [ ] No outstanding failures. (If any, fix and re-run.)

## Notes

- Editing `period_start_date` via Drizzle Studio is the fastest way to simulate at-cap / under-cap Pro states. Same pattern used in Phase 4 task-20.
- The Trial pill's "any batch counts" rule includes `cancelled` batches. That's by design (D-S12). Confirm during the cancelled-batch step.
- If a check fails because the Phase-4 `monthly_cap_active` arm hasn't been swapped to the dedicated `monthly_quota` variant (see task-07 note), that's a separate Phase-4 follow-up — not a regression here. Flag it but don't block.

## Out of scope

- Automated E2E (Playwright). Project doesn't have it yet; would belong in a separate spec.
- Lighthouse / accessibility scoring beyond keyboard + screen-reader smoke checks.
- Cross-browser matrix (Safari, Firefox, etc.). Chrome + Firefox is sufficient.
