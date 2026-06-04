# Task 19: E2E verification

## Status
not started

## Wave
6

## Description

Manual end-to-end walkthrough at `http://localhost:3000`. Covers every Stage-2 surface (the redesigned `/create` cards, the 2x2 `/schedule` grid, the new `/schedule/[batchId]` detail page, the functional `/library`, the rolling-4 eviction smoke, and the wizard bulk Schedule button dark-mode fix). Produces `specs/scheduled-and-create-redesign-stage-2/verification.md` as the artifact — task-18 stages Part 1 (audit + isolation tests); this task appends Part 2 (the manual runbook) and signs off.

This is the human-eyes gate before merging Stage-2. If any checkbox fails, file a follow-up task in `specs/scheduled-and-create-redesign-stage-2/tasks/` and link it before merge.

## Dependencies

**Depends on:** task-18 (audit + user-isolation regression tests must all PASS first — Part 1 of the verification artifact is already staged by task-18 when this task starts).
**Blocks:** none — this is the final task in Wave 6 and the final task in Stage 2.
**Parallel with:** none — Wave 6 runs sequentially. Task-19 runs last.

## Files to Modify

None directly — the verification artifact is appended-to / completed, not freshly written (task-18 staged Part 1).

## Files to Create

- `specs/scheduled-and-create-redesign-stage-2/verification.md` — only if task-18 did not already stage it. Either way, this task is responsible for the file being complete and signed-off at end.
- `specs/scheduled-and-create-redesign-stage-2/img/` — directory for any screenshots referenced in the artifact (e.g. dormant emerald box re-capture per `action-required.md`, dark-mode wizard icon evidence).

## Implementation Steps

### 1. Local setup

```bash
# Terminal 1
docker compose up -d

# Terminal 2
pnpm dev
```

Open `http://localhost:3000`. Have Drizzle Studio (`pnpm db:studio`) ready in a third terminal — switching plans and forcing batch states between sections is the fastest way to traverse the matrix. Confirm `BLOB_READ_WRITE_TOKEN` is set (see `action-required.md`) so the rolling-4 eviction smoke can verify zero `blob_orphan` rows.

Use Chrome + Firefox. Capture a mobile viewport (≤ `sm:`) somewhere in the run — best fit is during steps 5 and 6.

### 2. Runbook checklist

Execute each section against the local app. Tick boxes as PASS. Any **FAIL** must spawn a follow-up task in `specs/scheduled-and-create-redesign-stage-2/tasks/` before merge.

#### 2.1 Sidebar regression — still 4 items

- [ ] Desktop sidebar items in order: Create Posts, Image Library, Scheduled, Settings.
- [ ] No "My Posts" item.
- [ ] Mobile drawer (≤ `md:`) shows the same 4 items.
- [ ] Clicking each item routes correctly.

#### 2.2 Pill — Pro user, rolling-4 anchor

Set the user to Pro via Drizzle Studio (`subscriptions.plan = "pro"`).

- [ ] Fresh Pro (no scheduling/completed batches): pill reads `4 batches left`.
- [ ] After 1 scheduling batch: `3 batches left`.
- [ ] After 2 scheduling batches: `2 batches left`.
- [ ] After 3 scheduling batches: `1 batch left` (singular).
- [ ] After 4 scheduling batches: pill flips to `Resets in Nd`.
- [ ] Cancelled batches on `/create` do **not** deduct — generate a batch, cancel it from `/schedule` so it becomes a `cancelled` card on `/create`, confirm pill still reads `4 batches left` (or `N batches left` per the unrelated scheduling count).

#### 2.3 `/create` cancelled card copy + Delete forever

Use the cancelled batch from §2.2. Navigate to `/create`.

- [ ] Chip on the cancelled card reads exactly `CANCELLED` (no `— re-schedule` suffix; that copy is Stage-1 and is replaced).
- [ ] Primary CTA reads exactly `Open to reschedule →`. Clicking it navigates to `/posts?batchId={id}` in the wizard's reschedule mode.
- [ ] Secondary destructive `Delete forever` button is visible, right of the primary CTA.
- [ ] Click `Delete forever` → confirm dialog opens.
- [ ] Dialog body reads `"The batch and its posts will be removed. {N} images will move to your Image Library so you can reuse them."` where `{N}` matches the batch's actual `post_images` count.
- [ ] Confirm → success toast `"Batch deleted. {N} images saved to your Library."`
- [ ] Card disappears from `/create`. `/library` shows the freshly-retained images at the top of the grid.

#### 2.4 `/create` `in_progress` redirect copy

Force `weekly_batches.status = 'in_progress'` for one batch via Drizzle Studio (Stage-2 doesn't produce this state from data — it's a Phase-7 dormant surface).

- [ ] On `/create`, the redirect CTA reads exactly `See the batch currently posting →` (was Stage-1's `Return to your current batch →`).
- [ ] Link target unchanged — clicks navigate to `/posts?batchId={id}`.
- [ ] Revert the manual `in_progress` flip before continuing.

#### 2.5 `/schedule` — 2x2 grid + Create-next-batch CTA

Seed 2–4 batches with `status='scheduling'` via Drizzle Studio (or by walking through the wizard).

- [ ] Grid is `grid-cols-1 md:grid-cols-2` — single column on mobile, 2x2 on `md:+`.
- [ ] Past Batches disclosure from Stage-1 is **gone** (no `▸ Past batches (N)` trigger anywhere on the page).
- [ ] `[Create next batch — N/4]` CTA renders above the grid with the correct count.
- [ ] At 4/4 the CTA is disabled and hovering shows the tooltip `"Schedule a new batch by cancelling or finishing one."`
- [ ] When enabled, clicking the CTA navigates to `/create`.

#### 2.6 `<ScheduledBatchBox />` — 7-day strip + clickable count

For each box in the grid:

- [ ] The 7-day calendar strip renders **between** the header strip and the network-counts row (not above the header, not below the counts).
- [ ] Strip has exactly 7 cells, labeled `M T W T F S S` or short weekday abbreviations.
- [ ] Cells with a scheduled post show `✓` in `text-primary` (champagne).
- [ ] Cells whose post was cancelled show `✗` (or muted empty state) per ordinal — verify by cancelling a single post in §2.8 and re-checking this box.
- [ ] The `{N} posts` text is now a clickable `<Link>` — hovering shows underline.
- [ ] Clicking `{N} posts` navigates to `/schedule/{batchId}`.

#### 2.7 `/schedule/[batchId]` detail page

Click the `{N} posts` link from §2.6.

- [ ] Page renders 7 ordered day slots (one per `posts.postOrder` 1..7).
- [ ] Cancelled slots render greyed / italic with "No post for this day" or equivalent. No compaction — the slot stays in its ordinal position.
- [ ] Each non-cancelled slot shows: day-of-week label, scheduled time, post text preview, network icons (FB / IG / LI).
- [ ] Per-post `[Cancel]` button is visible on slots where `scheduledTime > now()` AND no `scheduled_posts.status='posted'` exists.
- [ ] Per-post `[Cancel]` button is **hidden** on slots whose `scheduledTime <= now()` (manually back-date one via Drizzle Studio to confirm).
- [ ] Page footer keeps the existing `[Cancel batch]` action.

#### 2.8 Per-post cancel — happy path

Pick a slot with `scheduledTime > now()` and a clear ordinal (e.g. day 4 of 7).

- [ ] Click `[Cancel]` → `<CancelPostDialog />` opens with copy `"Cancel this post? It will be removed from the batch. The image moves to your Image Library."`
- [ ] Confirm → success toast (the spec doesn't dictate exact copy here; verify the toast appears and is success-tone).
- [ ] Slot on the detail page flips to "skipped" empty state — no compaction; surrounding slots stay put.
- [ ] Navigate back to `/schedule`. The box's 7-day strip shows `✗` at the cancelled ordinal.
- [ ] `{N} posts` count decremented by 1.
- [ ] Navigate to `/library`. The cancelled post's image appears at the top of the grid; `{N}/30 images` header increments by 1.

#### 2.9 Per-post cancel — `already_posted` race

This race needs Drizzle Studio. Open the cancel dialog on a future-scheduled post (don't confirm yet). In Drizzle Studio, flip that post's `scheduled_posts.status` from `'pending'` to `'posted'`. Now click Confirm.

- [ ] Error toast appears: `"Already posted, can't cancel."` (or the equivalent inline `role="alert"` message per spec §7.1).
- [ ] No row was deleted in `posts`, `post_images`, `scheduled_posts`, or `library_images` for that post.
- [ ] `/schedule` box still shows `✓` at that ordinal (the post is now "posted" from the system's view — that's correct).
- [ ] Revert the manual `status='posted'` flip before continuing.

#### 2.10 Rolling-4 eviction smoke

Set up: have 4 batches in `status='scheduling'` (the existing 4) + 1 batch in `status='reviewing'`. Open the wizard for the reviewing batch and click "Schedule all" for each network; complete the wizard so `scheduleBatch` fires.

- [ ] Success toast reads `"Batch scheduled. Oldest batch retired."`
- [ ] `/schedule` still shows exactly **4 boxes** (the 3 newest from before + the just-scheduled batch). The previously-oldest batch is gone.
- [ ] The evicted batch's images do NOT appear in `/library` (rolling-4 eviction = `deleteImagesPermanently`, not `retainImagesToLibrary` — per D-S2-2 and spec §5.4).
- [ ] In Drizzle Studio, query `select * from post_logs where action = 'blob_orphan' order by created_at desc limit 10` — there should be **zero** new rows from this run if `BLOB_READ_WRITE_TOKEN` is set correctly. (If the token is missing, expect N rows, one per evicted image — note in the verification artifact and reference `action-required.md`.)

#### 2.11 `/library` — functional grid

After §2.10's eviction (and the §2.3 / §2.8 retains), the library has a populated state.

- [ ] Grid renders newest-first (most recently retained image at top-left).
- [ ] Header reads `Your image library` (Fraunces) + `{N}/30 images` (muted), with `N` matching `select count(*) from library_images where user_id = ?`.
- [ ] Grid is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6` per spec §6.12.
- [ ] Each tile shows the image, 1:1 aspect ratio, `rounded-2xl`, hover-lift transition (`shadow-lift` + `-translate-y-0.5`).
- [ ] Bottom overlay reveals `[Delete]` button on hover (or always-visible on touch).
- [ ] Click `[Delete]` → `<LibraryImageDeleteDialog />` opens with copy `"Delete this image forever?"` + `[Keep]` / `[Delete]` buttons.
- [ ] Confirm → success toast `"Image deleted."`. Tile disappears. Header decrements.
- [ ] Cap eviction smoke: drive the library to exactly 30 entries (via repeated batch generation + cancellation), then trigger one more retain. The toast should mention the eviction (e.g. `"Oldest image replaced to make room."` per spec §9 Risks row), and the library still shows 30 tiles — not 31.

#### 2.12 Wizard bulk Schedule button — dark mode visual

Generate a batch in `reviewing`. Open `/posts?batchId={id}`. Advance to any network's Review step.

- [ ] Switch to **dark mode** via the theme toggle in the header.
- [ ] Click `Schedule all`. The `CheckSquare` icon on the now-affirmation button is **clearly visible** against `bg-card` — no longer the pale coral that read as muted before this fix.
- [ ] Inspect the icon's computed `color` in DevTools: should resolve to `oklch(0.62 0.18 30)` (or the equivalent if the `.text-destructive-strong` utility fallback was used per task-17).
- [ ] Switch to **light mode**. The icon color is unchanged from Stage-1 — still the existing destructive token. (If it visibly changed in light mode, that's a regression — file a follow-up.)
- [ ] Capture a side-by-side screenshot (dark before / dark after, or dark vs light) into `specs/scheduled-and-create-redesign-stage-2/img/wizard-icon-dark-mode.png`. Reference it in the verification artifact.

#### 2.13 Cross-browser smoke

- [ ] Repeat §2.5–§2.7 (the redesigned `/schedule` grid + detail page) in **Firefox**. Layout, hover states, and link behavior match Chrome.
- [ ] Mobile viewport (≤ `sm:`, e.g. iPhone SE in DevTools device emulation): `/schedule` grid collapses to single column; `/library` collapses to `grid-cols-2`; `/create` cards stack; no horizontal scroll on any page; the `[Create next batch — N/4]` CTA is full-width on mobile per spec §6.6.

### 3. Write `verification.md`

Task-18 staged Part 1 (audit + isolation tests). This task appends Part 2 (the runbook results from §2 above) and the sign-off block. Final structure:

```
# Verification — Scheduled & Create Posts Redesign Stage 2

Date: YYYY-MM-DD
Tester: <name>
Branch: <branch>
Commit: <sha>

---

## Part 1 — Automated audit (task 18)
(populated by task-18; do not overwrite)

---

## Part 2 — Manual E2E walkthrough (task 19)

### 2.1 Sidebar regression — PASS / FAIL
- [ ] (paste criteria from §2.1 above, ticked)

### 2.2 Pill — Pro rolling-4 — PASS / FAIL
- [ ] (paste §2.2)

### 2.3 /create cancelled card + Delete forever — PASS / FAIL
...

### 2.4 /create in_progress copy — PASS / FAIL
...

### 2.5 /schedule grid + CTA — PASS / FAIL
...

### 2.6 ScheduledBatchBox 7-day strip + count link — PASS / FAIL
...

### 2.7 /schedule/[batchId] detail page — PASS / FAIL
...

### 2.8 Per-post cancel — happy path — PASS / FAIL
...

### 2.9 Per-post cancel — already_posted race — PASS / FAIL
...

### 2.10 Rolling-4 eviction smoke — PASS / FAIL
- [ ] post_logs.blob_orphan rows: 0 (BLOB token set) / N (token missing — see action-required.md)

### 2.11 /library functional grid — PASS / FAIL
...

### 2.12 Wizard bulk Schedule dark-mode icon — PASS / FAIL
![wizard icon dark mode](./img/wizard-icon-dark-mode.png)

### 2.13 Cross-browser + mobile — PASS / FAIL
- [ ] Chrome: PASS
- [ ] Firefox: PASS
- [ ] Mobile viewport (≤ sm): PASS

---

## Part 3 — Outstanding issues

(fill in any failed criteria with file paths + reproduction steps; empty = clean run)

- (none)

---

## Sign-off

- [ ] Every checkbox in Parts 1 and 2 verified.
- [ ] Wizard-icon dark-mode screenshot stored under specs/scheduled-and-create-redesign-stage-2/img/.
- [ ] No outstanding failures.
```

### 4. File follow-ups for any failures

If §2 turned up any FAILs, create one `task-NN-follow-up-{slug}.md` per failure in `specs/scheduled-and-create-redesign-stage-2/tasks/`, reference it from Part 3 of the artifact, and do not merge until each follow-up either lands a fix or is explicitly deferred with rationale.

## Acceptance Criteria

- [ ] Every checkbox in §2.1 through §2.13 above is verified PASS in `verification.md`.
- [ ] The wizard dark-mode icon screenshot is captured and stored under `specs/scheduled-and-create-redesign-stage-2/img/wizard-icon-dark-mode.png`.
- [ ] (Conditional) The dormant emerald `currently_posting` box screenshot is re-captured if its anatomy changed (per `action-required.md`'s note about the 7-day strip addition).
- [ ] `verification.md` includes Part 1 (task-18 audit results) + Part 2 (this task's runbook) + Part 3 (outstanding issues, empty if clean) + Sign-off block.
- [ ] No outstanding failures, OR every failure has a linked follow-up task.
- [ ] Rolling-4 eviction smoke verified zero `post_logs.action='blob_orphan'` rows (or the artifact documents the BLOB token misconfiguration).

## Notes

- Drizzle Studio (`pnpm db:studio`) is the fastest way to flip plans, force batch statuses, and inspect `post_logs` between sections. Same pattern as Stage-1 task-13.
- The Trial pill and Starter pill behaviors are unchanged from Stage-1 (D-S2-10). They're not re-tested here — Stage-1's `verification.md` covers them. If a tester wants belt-and-braces, run §2.2–§2.7 from Stage-1's verification.md as well.
- §2.9 (`already_posted` race) is the most fiddly. Two browser windows side-by-side help — one for the dialog, the other for Drizzle Studio. Once `scheduled_posts.status` is `'posted'`, the dialog confirm hits the gate per D-S2-7.
- §2.10's `blob_orphan` check is the single best assertion that production deletion paths actually delete blobs. If the token is missing in local dev (common when working off a fresh `.env.local`), reference `action-required.md` and either fix it OR note that production will be the first time it's exercised.
- The dormant emerald `currently_posting` variant lives in `scheduled-batch-box.tsx` — Stage-2 doesn't produce it from data. If the box's anatomy gained the 7-day strip (it does), capture a fresh screenshot at `specs/scheduled-and-create-redesign-stage-2/img/currently-posting-box.png` and update the artifact.
- The verification artifact is the canonical sign-off for Stage 2. Do not merge the implementation PR until this file is complete and clean.

## Out of scope

- Playwright / browser-driven automation. Stage-2 stays manual-only — Phase 7 may introduce a test harness once OAuth + publishers are involved.
- Safari + Edge browser sweeps. Chrome + Firefox is sufficient per Stage-1 convention.
- Lighthouse / Core Web Vitals. Separate spec when the dashboard ships.
- Visual regression diffs (Chromatic / Percy). Not adopted by the project.
- Cross-network publish smoke (FB / IG / LI live). Phase 7 owns the publisher work; Stage 2 only sets up the data + UI surfaces.
- Verifying the soft-delete trash / restore / 30-day purge contract. Deferred spec, not Stage-2.
