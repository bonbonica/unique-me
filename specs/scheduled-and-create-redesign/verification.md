# Verification — Scheduled & Create Posts Redesign

**Date:** 2026-06-03
**Tester:** _(fill in before sign-off)_
**Branch:** `main`
**Commit:** `996189a`

---

## Part 1 — Automated audit (task 12)

Run from repo root. All checks executed against the post-Wave-4 tree.

### 1.1 Quality gates

| Gate | Command | Exit | Result |
|---|---|---:|---|
| Lint | `pnpm lint` | 0 | **PASS** |
| Typecheck | `pnpm typecheck` | 0 | **PASS** |
| Production build | `pnpm build:ci` | 0 | **PASS** — 21 routes generated (`/create`, `/schedule`, `/posts`, `/library`, `/pricing`, etc.), no warnings beyond the unrelated pnpm `overrides` deprecation notice. |

### 1.2 Stage-1 scope — no surprise reads of `scheduled_posts`

```
rg "scheduled_posts|scheduledPosts" \
  src/components/schedule/ \
  src/components/create/ \
  src/app/\(app\)/\(onboarded\)/schedule/ \
  src/app/\(app\)/\(onboarded\)/create/
```

- **Result:** zero matches across all four directories. **PASS** — dormant contract preserved (every batch state is derived from `weeklyBatches.status` alone, per D-S5).

### 1.3 `stopBatch` unchanged

Spec rule (D-S6, §10): `stopBatch()` must not be edited in this redesign. Spec referenced lines 898–939; the function has since drifted to **line 1224** because this redesign added `getUnscheduledBatchesForUser` and `getScheduledViewForUser` above it.

- `git log -L:stopBatch:src/lib/services/post-service.ts` confirms the only commit that ever modified the function body is `570cefd` (Phase 2 Wave 3 — its original introduction). None of the redesign commits (`c9fd823`, `4927e63`, `5fad252`, `996189a`) touched it.
- Function body inspected at `src/lib/services/post-service.ts:1224–1265`: identical to the Phase-2 implementation (status-guarded UPDATE, `scheduling → cancelled`, preserves posts/selections).
- **Result:** **PASS** — body is untouched; only its line number drifted.

### 1.4 Sidebar cleanup

```
rg "My Posts" src/components/dashboard/
```

- **Result:** 1 match — `src/components/dashboard/sidebar.tsx:22`, inside a JSDoc block explaining *why* the item was removed and what `/posts` deep-links now do. Documentation, not stale code. **PASS.**

```
rg "DASHBOARD_NAV_ITEMS" src/components/dashboard/sidebar.tsx
```

- **Result:** definition at line 32 + reference at line 65. Array contains exactly 4 items in the spec-mandated order: Create Posts, Image Library, Scheduled, Settings. **PASS.**

### 1.5 Trial pill → `/pricing`

```
rg '"/pricing"' src/components/dashboard/quota-countdown-pill.tsx
```

- **Result:** `Link href="/pricing"` at line 67 (plus a JSDoc reference at line 12). **PASS.**

### 1.6 Cancel dialog dormant contract

```
rg "alreadyPostedCount|queuedCount" \
  src/components/schedule/cancel-batch-dialog.tsx
```

- **Result:** both props appear on the `Props` type with the spec-mandated defaults (`alreadyPostedCount?: number` default `0`; `queuedCount?: number` defaulting to `totalPosts`). The split block is gated on `alreadyPostedCount > 0` (line 50), so in Stage-1 it never renders. **PASS** — D-S7 contract intact.

### 1.7 No new dependencies

```
git diff --stat package.json pnpm-lock.yaml
```

- **Result:** no output. **PASS** — spec scope honored.

### 1.8 No schema changes

```
git diff --stat src/lib/schema.ts drizzle/
```

- **Result:** no output. `drizzle/` still contains migrations 0000–0006 from prior phases. **PASS** — D-S16 honored.

### 1.9 Voice spot-check (DESIGN.md §14, no exclamation points)

```
rg "!" src/components/schedule/ src/components/create/ -g "*.tsx"
```

- **Result:** every match is a TypeScript operator (`!==`, `!open`, `!hasCapacity`, non-null assertion `!`). Zero `!` characters in user-facing strings. **PASS.**

### 1.10 Audit summary

| Criterion | Result |
|---|---|
| `pnpm lint` exits 0 | ✅ |
| `pnpm typecheck` exits 0 | ✅ |
| `pnpm build:ci` exits 0 | ✅ |
| No new `scheduled_posts` reads in spec-touched dirs | ✅ |
| `stopBatch()` body unchanged | ✅ |
| "My Posts" removed from sidebar nav | ✅ |
| Trial pill links to `/pricing` | ✅ |
| Dialog props include `alreadyPostedCount` + `queuedCount` | ✅ |
| `package.json` + `pnpm-lock.yaml` unchanged | ✅ |
| `src/lib/schema.ts` + `drizzle/` unchanged | ✅ |
| No exclamation points in user copy | ✅ |

**Task 12 status: PASS.** Cleared to run task 13.

---

## Part 2 — Manual E2E walkthrough (task 13)

Execute against `http://localhost:3000` after `docker compose up -d` + `pnpm dev`. Use Drizzle Studio (`pnpm db:studio`) to switch plans and force batch states between sections.

> Tick each box once verified. Any **FAIL** must spawn a follow-up task before merge.

### 2.1 Sidebar audit

- [ ] Desktop sidebar items in order: Create Posts, Image Library, Scheduled, Settings. No "My Posts".
- [ ] Mobile drawer (≤ `md:`) shows the same 4 items.
- [ ] Clicking each item routes correctly (`/create`, `/library`, `/schedule`, `/settings`).
- [ ] Visiting `/posts/{batchId}` does NOT highlight any sidebar item (intentional).

### 2.2 Top pill — Trial user, no batch

Use a fresh Trial user (no rows in `weekly_batches`).

- [ ] Pill reads exactly `Trial · 1 batch`.
- [ ] Pill is not a link (no hover affordance, no underline).

### 2.3 Top pill — Trial user, after generating

Generate one batch, leave it in `reviewing`.

- [ ] Pill reads exactly `Trial used · Upgrade`.
- [ ] Pill is wrapped in a link — hover shows affordance.
- [ ] Clicking navigates to `/pricing`.

### 2.4 Top pill — Trial user, after cancelling

Cancel the batch via `/schedule` (must first move it to `scheduling`, then cancel).

- [ ] Pill still reads `Trial used · Upgrade` (cancelled batches count — D-S12).
- [ ] Still links to `/pricing`.

### 2.5 Top pill — Starter

Set `subscriptions.plan = "starter"`, `period_start_date = now()`.

- [ ] Fresh Starter (no batch): `1 batch left`.
- [ ] After generating one batch: `Resets in Nd` where N is reasonable (≤ 30).

### 2.6 Top pill — Pro

Set `subscriptions.plan = "pro"`, `period_start_date = now()`.

- [ ] Fresh Pro: `4 batches left`.
- [ ] After 1 batch: `3 batches left`.
- [ ] After 3 batches: `1 batch left` (singular).
- [ ] After 4 batches: `Resets in Nd`.

### 2.7 Create Posts hub — fresh state (0 unscheduled)

Trial user with no batch, OR Pro with all 4 batches in `scheduling`/`completed`.

- [ ] `<UnscheduledBatchList />` does NOT render.
- [ ] `<GenerateForm />` (or the appropriate gated screen) renders directly under the header.
- [ ] Header reads `Create Posts` (Fraunces, `text-3xl sm:text-4xl`).

### 2.8 Create Posts hub — 1+ unscheduled

Trial or Pro with 1+ batches in `reviewing` or `cancelled`.

- [ ] `[Start new batch]` (champagne) and `[See scheduled posts →]` (outline) buttons visible at top.
- [ ] Cards stack below the button row with `gap-4`.
- [ ] `reviewing` cards render the **IN REVIEW** chip in champagne (`bg-primary/15 text-primary`).
- [ ] `cancelled` cards render the **CANCELLED — re-schedule** chip in amber (`bg-amber-500/15 text-amber-300`).
- [ ] Each card shows theme, importantThing (truncated to 1 line via `line-clamp-1`), per-network counts (FB / IG / LI), total posts.
- [ ] `[Open →]` navigates to `/posts?batchId={id}` and lands in the correct wizard mode.
- [ ] When 1+ cards exist, the form is collapsed by default (D-S14).

### 2.9 Create Posts hub — at-cap state

Pro with 4 batches used.

- [ ] `[Start new batch]` is disabled with tooltip `"You've used all batches this period."` (or the current Phase-4 equivalent — flag any drift but don't block).
- [ ] `<QuotaGatedScreen variant="monthly_quota">` renders below the cards.
- [ ] `[See scheduled posts →]` still works.

### 2.10 Scheduled page — empty state

User with no `scheduling` or `completed` batches.

- [ ] Header reads `Scheduled`.
- [ ] Body shows `"You don't have any scheduled batches yet."` + `[Start a new batch →]` button.
- [ ] The button links to `/create`.

### 2.11 Scheduled page — current period batches

Manually flip a batch to `status='scheduling'` via Drizzle Studio (or the wizard's Schedule action if wired).

- [ ] One `<ScheduledBatchBox />` per `scheduling` batch.
- [ ] Pro batches show `BATCH 1 · UPCOMING`, `BATCH 2 · UPCOMING`, ... using `batchOrdinalInPeriod`.
- [ ] Trial/Starter batches show `BATCH · UPCOMING` (no ordinal).
- [ ] Header strip is blue (`bg-primary/15 text-primary border-primary/30`). No emerald.
- [ ] Body shows theme, importantThing, FB/IG/LI counts, `N posts`.
- [ ] `[Cancel batch]` button visible.

### 2.12 Cancel batch flow (Stage-1, `alreadyPostedCount === 0`)

Click `[Cancel batch]` on an UPCOMING box.

- [ ] Dialog title reads `Cancel batch` (Fraunces).
- [ ] Body reads `"All N posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule."` with `N === totalPosts`.
- [ ] No split block renders (Stage-1 guarantee).
- [ ] Buttons: `[Keep batch]` (ghost) on the left, `[Cancel N posts]` (destructive coral) on the right.
- [ ] Confirm → Sonner `info` toast `"Batch cancelled — returned to Create Posts."`
- [ ] Box disappears from `/schedule`.
- [ ] `/create` now shows the batch as a `CANCELLED — re-schedule` card.

### 2.13 Cancel-already-cancelled race

Open two browser tabs, both on `/schedule`, both click `[Cancel batch]` on the same box.

- [ ] First confirm → success toast.
- [ ] Second confirm → error toast `"This batch was already cancelled."`
- [ ] Page refreshes; box is gone in both tabs.

### 2.14 Past Batches disclosure

**Stage-1 normal — empty disclosure (no `completed` rows exist yet):**

- [ ] Trigger renders closed by default as `▸ Past batches (0)` (or equivalent chevron).
- [ ] Click → reveals `"No finished batches in this period."`
- [ ] Chevron flips to `▾`.

**Optional populated case** — if you manually insert a `completed` row (Drizzle Studio: set a batch's `status = 'completed'`):

- [ ] Trigger shows `▸ Past batches (N)` with the real count.
- [ ] Opened body shows compact rows: `{date}  {theme}  N posts ✓`.
- [ ] Rows sorted ASC (oldest first).
- [ ] Remember to revert the manual edit before merging.

### 2.15 Dormant variant smoke (`currently_posting` emerald)

Stage-1 never produces this state from real data. Force it temporarily by either:

- editing `getScheduledViewForUser()` to return `derivedState: "currently_posting"` for one row, OR
- mounting a dev preview route at `src/app/dev/scheduled-box-preview/page.tsx`.

Verify:

- [ ] Header strip is emerald (`bg-emerald-500/15 text-emerald-300 border-emerald-500/30`).
- [ ] Label reads `BATCH N · CURRENTLY POSTING` for Pro (or `BATCH · CURRENTLY POSTING` for Trial/Starter).
- [ ] Theme, importantThing, counts, total, and `[Cancel batch]` all render identically to the blue variant.
- [ ] Clicking `[Cancel batch]` still opens the dialog.

**Capture a screenshot** and save to `specs/scheduled-and-create-redesign/img/currently-posting-box.png`. Then **revert the temporary edit** — the data layer must remain Stage-1 clean before merging.

```
![currently-posting box](./img/currently-posting-box.png)
```

### 2.16 Visual + voice spot-checks

- [ ] No exclamation points anywhere on the redesigned pages (DESIGN.md §14). Pre-checked in §1.9 — re-confirm visually.
- [ ] All Lucide icons render at `strokeWidth={1.5}` (DESIGN.md §10).
- [ ] Card hover transitions to `shadow-lift` + `-translate-y-0.5` over 300ms (DESIGN.md §11).
- [ ] Dark + light mode both legible. Trial-used pill remains readable on cream (light) background.
- [ ] Mobile (≤ `sm:`): cards stack, button row wraps gracefully, no horizontal scroll, no clipping.

---

## Part 3 — Outstanding issues

_(Fill in any failed criteria from Part 2 here. Empty = clean walkthrough.)_

- (none)

---

## Sign-off

- [ ] Every checkbox in Parts 1 and 2 verified.
- [ ] Dormant emerald variant screenshot stored under `specs/scheduled-and-create-redesign/img/`.
- [ ] No outstanding failures.
