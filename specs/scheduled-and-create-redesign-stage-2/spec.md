# Scheduled & Create Posts Redesign — Stage 2

Stage 1 (UI-only, sidebar + cards + dormant contracts) shipped at `specs/scheduled-and-create-redesign/`. Stage 2 wires real behavior on top: rolling-4 batch retention, hard-deletes with image preservation, an Image Library, per-post cancel, and small UI fixes.

## 0. Status of items flagged this revision

### Wave-4 corrections (this spec update)

Wave-4 shipped a `<SevenDayStrip />` on each `<ScheduledBatchBox />`. Two bugs were discovered after the fact:

1. **Truth source bug.** The strip marked a day "scheduled" (✓) based on the presence of a `posts` row for that ordinal. The real truth is whether a `scheduled_posts` row exists for that `(postId, platform)` pair. A post can exist without being scheduled to a given network.
2. **Hardcoded length bug.** The strip rendered exactly 7 cells (`for (let ordinal = 1; ordinal <= 7; ordinal++)`). Pro batch 4 is 9 posts, so posts 8 and 9 were silently dropped from the strip while still being counted in `{N} posts`.

**Correction.** The per-day strip is removed from `<ScheduledBatchBox />`. The per-day / per-network view moves to the detail page at `/schedule/[batchId]` and becomes a **network × day grid** (rows = networks, columns = days, column count = real batch length, cell = ✓ iff a `scheduled_posts` row exists for that pair). See updated D-S2-12, D-S2-15, §5.3, §6.7, §6.8, §6.9, §6.10, §10, §11.

This spec update edits the affected sections in place. Task-15 is re-issued after spec sign-off; task-13 (component + data field) is undone in a follow-up corrective code wave (component + `days[]` + strip-related computation in `getScheduledViewForUser` all get deleted together).

### Cancel-vs-Delete contract (this spec update)

Earlier drafts of Stage-2 specced per-post `cancelPost` as a destructive `DELETE FROM posts` with cascade + image-to-Library preservation. That was wrong for the product intent. The corrected contract:

1. **CANCEL is non-destructive and retrievable.** `cancelPost(sessionUserId, postId, platform?)` becomes an `UPDATE scheduled_posts SET status='cancelled'` over the chosen scope. The `scheduled_posts.status` union gains a new value `'cancelled'` (additive; text column — no Drizzle migration). The post family (`posts`, `post_variations`, `post_selections`, `post_images`) is preserved. **No image movement on cancel** — the image stays attached because the post still exists. Reversible via `restorePost` (D-S2-21).
2. **Per-network granularity is now possible at the service layer.** Omitting `platform` cancels every `pending` row for the post (whole-post cancel — the only UI surface in Stage-2). Supplying `platform` cancels just that one network's row. Stage-2 UI calls cancel whole-post only; per-network UI is a later concern.
3. **Readers treat `'cancelled'` like absent.** Network × Day grid cell (D-S2-15) = ✓ iff a `scheduled_posts` row exists for `(postId, platform)` with `status IN ('pending', 'posted')`. `getScheduledViewForUser` per-network counts and the box's `{N} posts` total exclude `'cancelled'` rows so the user sees what's actually scheduled.
4. **DELETE is reserved as a future destructive surface (D-S2-22).** `postService.deletePost(sessionUserId, postId)` is named in the spec but NOT built in Stage-2. When built, it will be the path that retains the image to the Library and `DELETE FROM posts` with cascade — and will be what later triggers AI per-network regeneration (an entirely deleted post may be re-generated; a merely cancelled post is preserved as-is). Naming it now prevents a competing destructive cancel path from being added by mistake.
5. **Batch-level surfaces are UNCHANGED.** `stopBatch` (the `[Cancel batch]` action) still flips `weekly_batches.status` → `cancelled` with no cascade (already retrievable via the `/create` card — D-S6 in Stage-1). `deleteBatchForever` (the `[Delete forever]` action on cancelled cards) still does image-preservation + cascade `DELETE FROM weekly_batches`. Only per-post `cancelPost` changes.
6. **Image Library implication.** Because cancel no longer feeds the Library, and `deletePost` doesn't exist yet, the only path that fills `library_images` in Stage-2 is `deleteBatchForever`. The Library will stay empty for most users until `deletePost` ships in a future spec. Task-16 (the `/library` page) still ships as planned — it just has fewer inputs until then.

See updated D-S2-6, D-S2-7, D-S2-21 (new), D-S2-22 (new), §2.2, §5.3, §6.9, §6.11, §8, §10. Wave 4.5 corrective code wave applies this contract alongside the strip removal; task-15 re-issue calls the new `cancelPost` signature.

### Resolved (locked into the spec body)

- **Rolling-4 counting basis** = `weekly_batches.status IN ('scheduling', 'completed')`. Cancelled and reviewing batches do NOT eat a rolling-4 slot — they live on `/create` as cards. Slot consumption happens at the **schedule action**, not at generation.
- **Image Library** lives in a new `library_images` table, capped at 30 per user (rolling, oldest-by-`createdAt` evicts). `library_images` survives parent-post deletion; `post_images` is for the attached-to-a-post case.
- **Image-service helper** (`src/lib/services/image-service.ts`) is the single orchestrator for blob lifecycle. All deletion paths go through it. Order is invariant: **read URL → blob `del()` → DB row removal.** Blob failures log to `post_logs.action='blob_orphan'` and never block the caller.
- **Per-post cancel** = non-destructive status flip on `scheduled_posts` to `'cancelled'` (additive value; no DELETE, no cascade, NO image movement). Post family preserved. Available until the chosen scope (per-post or per-`(postId, platform)`) has at least one `scheduled_posts` row with `status='pending' AND scheduledTime > now()` AND no row with `status='posted'`. **Reversible via `restorePost`** (D-S2-21). True destruction is the reserved future `deletePost` (D-S2-22) — not built in Stage-2. See Cancel-vs-Delete contract at §0.
- **Delete-forever** on a cancelled card = hard-delete the batch, preserve images. Same retention rule. Available on `status='cancelled'` only.
- **Schedule page redesign**: 2x2 grid (max 4 boxes), single column on mobile, drops the Stage-1 Past Batches disclosure. `[Create next batch — N/4]` CTA above the grid; each box gets a clickable "N posts" link that opens the detail page. **No per-day strip on the box** — per-day / per-network view lives ONLY on the detail page (see D-S2-15 and Wave-4 corrections above).
- **`/schedule/[batchId]` detail page** (new) renders 7 ordered day-slots with per-post cancel controls. Cancelled posts leave the slot empty/skipped (no compaction).
- **`/library`** becomes a functional page (was Stage-1 placeholder).
- **Top pill** re-anchored: `N batches left` while `scheduledBatchCount < 4`; `Resets in Nd` at `scheduledBatchCount === 4`. Cancelled cards on `/create` don't deduct. Trial/Starter pill behavior unchanged.
- **Cancelled card copy fixes**: chip becomes plain `CANCELLED`; CTA becomes `Open to reschedule →`; new destructive `Delete forever` action.
- **`in_progress` /create copy** updates from `Return to your current batch →` to `See the batch currently posting →`.
- **Wizard bulk Schedule button checked-icon** — deepen the dark-mode red so the "scheduled" affirmation reads at a glance. Stays in the warm palette per DESIGN.md (no pure crimson). Light mode unchanged.
- **User-isolation contract**: every service-layer write enforces `userId === sessionUserId` at row read time. Explicit regression tests assert User-A actions never touch User-B's data.
- **All deletions are synchronous** at action time (user preference). No background jobs.

### Items deliberately deferred (future specs, named so they don't sneak in)

- **Soft-delete trash + 30-day auto-purge for `deletePost`-removed content.** Stage-2's per-post cancel IS retrievable via `restorePost` (D-S2-21) — that satisfies the reversibility half of the original trash concept. The future spec covers true-`deletePost` recovery + automatic purge after N days; it will reuse `image-service.ts` for its purge job.
- **`deletePost(sessionUserId, postId)` — true per-post destructive action** (D-S2-22). Reserved name only in Stage-2; not built. Required to start filling the Image Library from per-post flows and to drive future AI per-network regeneration.
- **Google Business Profile + X (Twitter)** as additional networks, with per-network max character limits.
- **Drag-to-reorder posts** within a batch.
- **Phase 7 posting service** (OAuth + FB/IG/LI publish, retry semantics, success/failure notifications). The dormant `currently_posting` emerald box variant stays present in the component for that work; Stage-2 still never produces it from data.
- **Phase 4 cron auto-scheduler.** `scheduleBatch` is a user-initiated action only in Stage 2.

---

## 1. Decisions locked

| # | Decision |
|---|---|
| **D-S2-1** | Rolling-4 counting basis = `weekly_batches.status IN ('scheduling', 'completed')` for the signed-in user. Cancelled and reviewing batches are excluded from the count and from the `/schedule` grid. |
| **D-S2-2** | Rolling-4 eviction fires inside `scheduleBatch` when the flip from `reviewing → scheduling` would push the scheduled count from 4 to 5. The oldest (by `createdAt`) of the previous 4 is hard-deleted: blob `del()` per image URL, then `delete from weekly_batches where id = ?` (cascade cleans posts + post_images + post_variations + post_selections + scheduled_posts). |
| **D-S2-3** | Blob failures during eviction are best-effort: each failure logs to `post_logs` with `action='blob_orphan'` and `details: { url, reason }`. The Schedule action commits regardless. |
| **D-S2-4** | New table `library_images` (see §5.1). One row per retained image. Per-user, FK on `userId` with `onDelete cascade`. No FK to `posts` — the originating post is gone by the time the row exists. |
| **D-S2-5** | Image Library cap = **30 per user**. When `retainImagesToLibrary` would push the count over 30, oldest-by-`createdAt` rows evict first (each eviction = `safeDeleteBlob` + delete row). Wrapped in a per-user `pg_advisory_xact_lock(hashtext('library:' || userId))` to make concurrent retains safe. |
| **D-S2-6** | `postService.cancelPost(sessionUserId, postId, platform?)` is a **non-destructive status flip** on `scheduled_posts`. Behavior: `UPDATE scheduled_posts SET status='cancelled' WHERE postId = ? AND status='pending'` scoped to `platform` when supplied (otherwise every `pending` row for the post). **No `DELETE`, no cascade, NO image movement.** The post family (`posts`, `post_variations`, `post_selections`, `post_images`) is preserved and the post remains restorable via `restorePost` (D-S2-21). Cancel is the lightweight, retrievable surface; true destruction is the reserved future `deletePost` (D-S2-22). *Corrects an earlier draft that did a destructive `DELETE FROM posts`; see Cancel-vs-Delete contract at §0.* |
| **D-S2-7** | Per-post cancel availability gate = the scope chosen by `cancelPost(postId, platform?)` has at least one `scheduled_posts` row with `status='pending' AND scheduledTime > now()` AND NO `scheduled_posts` row (in the same scope) with `status='posted'`. Else `cancelPost` returns `already_posted` and the UI toast says "Already posted, can't cancel." Restore (`restorePost`, D-S2-21) uses the symmetric gate: at least one `'cancelled'` row in scope with `scheduledTime > now()` AND no `'posted'` row in scope. |
| **D-S2-8** | `postService.deleteBatchForever(sessionUserId, batchId)` is available only on `weekly_batches.status='cancelled'`. Image-preservation rule mirrors D-S2-6 (per-post, per-image). Reviewing batches use the existing wizard discard flow — not this surface. |
| **D-S2-9** | Image-service primitive `safeDeleteBlob(url)`: calls `del(url)` from `@vercel/blob`; catches any error; logs `post_logs.action='blob_orphan'` on failure with `details: { url, reason }`; never throws. Used by both `retainImagesToLibrary` (for eviction during cap overflow) and `deleteImagesPermanently` (for rolling-4 batch purge). |
| **D-S2-10** | Top pill (Starter/Pro). Under cap (`scheduledBatchCount < 4`): `{N} batches left` where `N = 4 - scheduledBatchCount`. At cap (`=== 4`): `Resets in {N}d`. Trial pill unchanged from Stage-1 D-S12. The Stage-2 in-page CTA (D-S2-13) covers in-page capacity display; the pill is not duplicated there. |
| **D-S2-11** | `/schedule` renders a 2x2 grid for up to 4 boxes (`scheduling + completed`), sorted by `createdAt DESC`. Single column on mobile (`grid-cols-1 md:grid-cols-2`). The Stage-1 Past Batches disclosure is removed (the rolling-4 IS the history). Empty state copy unchanged from Stage-1. |
| **D-S2-12** | The `<ScheduledBatchBox />` does NOT render a per-day strip on the Scheduled grid. `BatchBoxData` carries no `days[]` field. Per-day / per-network truth lives ONLY on the detail page `/schedule/[batchId]` (D-S2-15). The box's surface — header strip, theme, per-network counts, `{N} posts` link, cancel batch button — stays exactly as Wave-3 left it (plus the link wrap from D-S2-14). *Corrects Wave-4: the strip was hardcoded to 7 cells and marked checks from `posts`-row presence rather than real `scheduled_posts` rows. See Wave-4 corrections at §0.* |
| **D-S2-13** | `[Create next batch — N/4]` CTA renders above the 2x2 grid on `/schedule`. Disabled at `4/4` with tooltip `"Schedule a new batch by cancelling or finishing one."` Links to `/create`. |
| **D-S2-14** | Each box's `{N} posts` text becomes a `<Link>` to `/schedule/[batchId]`. |
| **D-S2-15** | `/schedule/[batchId]` (new page) renders a **network × day grid**: rows = networks (Facebook, Instagram, LinkedIn today — architected so additional rows can be appended for Google Business Profile, X, etc.), columns = days of the batch. Column count = the **real batch length** (`weeklyBatches.totalPosts` or equivalently `MAX(posts.postOrder)`), not hardcoded to 7 — Pro batch 4 = 9 posts. Each cell is a check (✓) iff a `scheduled_posts` row exists for that `(postId, platform)` pair; otherwise an X (✗). Below the grid the page lists each post (text + scheduled time + per-post `[Cancel]`) so the existing cancel affordance (per D-S2-6 / D-S2-7) is preserved. Page footer keeps the existing `[Cancel batch]` action. |
| **D-S2-16** | `/create` cancelled card: chip text = `CANCELLED` (no `— re-schedule`). Primary CTA = `Open to reschedule →`. Secondary destructive action = `Delete forever` (opens confirm dialog explaining image preservation). |
| **D-S2-17** | `/create` `in_progress` redirect copy = `See the batch currently posting →` (was `Return to your current batch →`). No behavior change; copy only. |
| **D-S2-18** | `/library` renders the user's `library_images` rows, newest-first, in a responsive grid. Header text: `{N}/30 images`. Each tile has a destructive `[Delete]` action → confirm dialog → `imageService.deleteLibraryImage`. |
| **D-S2-19** | Wizard bulk Schedule button (in `wizard-step.tsx:160`) checked-state icon — deepen the dark-mode red toward `oklch(0.62 0.18 30)` (rust/coral, still in the warm family per DESIGN.md). Light mode value unchanged (the dark-mode pale coral is the surface that fails). Only the icon `text-*` class flips on `isAllSelected`; surrounding chrome unchanged. |
| **D-S2-20** | New Drizzle migration required for `library_images`. Run `pnpm db:generate` to produce the SQL, then `pnpm db:migrate` to apply locally. **Never `pnpm db:push`.** The migration commits to `drizzle/` with the next sequential number. |
| **D-S2-21** | `postService.restorePost(sessionUserId, postId, platform?)` reverses a `cancelPost` for the chosen scope: `UPDATE scheduled_posts SET status='pending' WHERE postId = ? AND status='cancelled'` (filtered by `platform` when supplied; otherwise every `'cancelled'` row for the post). Gate: at least one `'cancelled'` row in scope with `scheduledTime > now()` AND no `'posted'` row in scope. No image movement, no row insert — the schedule entry was always there. Readers (network × day grid, per-network counts, box `{N} posts`) treat `'cancelled'` as absent, so a restore flips ✗ → ✓ on the grid and the row reappears in the per-network list. UI affordance (where the `[Restore]` button lives on the detail page) is a task-15 re-issue concern. See Cancel-vs-Delete contract at §0. |
| **D-S2-22** | `postService.deletePost(sessionUserId, postId)` is the **reserved-future** destructive per-post action. When built (deferred — NOT Stage-2): `imageService.retainImagesToLibrary(sessionUserId, [postId])` then `DELETE FROM posts WHERE id = postId AND userId = sessionUserId` (cascade fires — same retain-then-delete pattern as `deleteBatchForever`, D-S2-8). It is the surface that will later trigger AI per-network regeneration (an entirely deleted post may be re-generated; a merely cancelled post is preserved). The name is reserved in the spec so no destructive cancel path is added by accident on top of `cancelPost`. Stage-2 does NOT build this. The Image Library will stay empty for most users until this surface exists. See §8 deferred items. |

---

## 2. End-to-end flow scenarios

### 2.1 Pro user schedules their 5th batch (rolling-4 eviction)

User has 4 batches in `scheduling`: ordinals 1–4, created 18d, 12d, 7d, 3d ago. User now has a 5th batch in `reviewing` (created today). User opens the wizard, clicks "Schedule all" for each network, completes the wizard.

`scheduleService.scheduleBatch(userId, batch5.id)` runs:
1. Updates `weekly_batches.status` of batch5 from `reviewing` → `scheduling` in a guarded UPDATE.
2. Counts `scheduling + completed` batches for the user. Result: 5.
3. Selects the oldest by `createdAt` (the 18-day-old batch1).
4. Reads `image_url` for all `post_images` rows whose `post.batch_id = batch1.id` (could be 0–7 URLs).
5. For each URL, `safeDeleteBlob(url)` → swallows errors, logs orphans.
6. Deletes `weekly_batches` row for batch1 → cascade fires.
7. Returns success. UI toast: "Batch scheduled. Oldest batch retired."

User lands on `/schedule`: the grid shows the new batch1 (formerly batch2), batch2 (formerly batch3), batch3 (formerly batch4), batch4 (formerly batch5). Ordinals re-derive from `weekly_batches.batchOrdinalInPeriod` — Stage-2 does NOT renumber.

### 2.2 Trial user cancels their one post

Trial user has 1 batch in `scheduling`, 7 posts, scheduled across 7 days. Today is day 0; first post fires in 2 hours. User opens `/schedule/[batchId]`, clicks `[Cancel]` on post #4 (scheduled for 4 days from now).

`postService.cancelPost(userId, post4.id)` runs (whole-post scope — no `platform` argument):
1. Reads `posts` row, confirms `userId === sessionUserId`. If not → `not_found` / `not_owned`.
2. Reads `scheduled_posts` rows for post4. Applies the D-S2-7 gate: at least one row with `status='pending' AND scheduledTime > now()`, no row with `status='posted'`. If the gate is closed → `already_posted` and the UI shows a toast.
3. `UPDATE scheduled_posts SET status='cancelled' WHERE postId = post4.id AND status='pending'`. **No DELETE, no cascade, no image movement.** The post family — `posts`, `post_variations`, `post_selections`, `post_images` — and the image blob are all preserved.
4. Returns `{ ok: true, batchId, cancelledCount: 3 }` (FB + IG + LI flipped to `cancelled`).

UI updates: on the detail page, the network × day grid shows ✗ in every cell of the post-4 column (the rows still exist but their status is `'cancelled'`, which the reader treats as absent — D-S2-15 cell filter). Post-4 disappears from each network section in the per-post list below. On `/schedule` the box's `{N} posts` count drops to 6 because counts now exclude `'cancelled'` rows.

**Restore path.** Later the user can click `[Restore]` (UI affordance defined by task-15 re-issue). `postService.restorePost(userId, post4.id)` runs the symmetric `UPDATE scheduled_posts SET status='pending' WHERE postId = post4.id AND status='cancelled'` subject to D-S2-21's still-future + no-posted gate. The post reappears in the grid (cells flip ✗ → ✓) and back into each network section; the box's `{N} posts` count increments back to 7. The image was never moved, so nothing has to be re-attached.

**Library implication.** Cancel does NOT add anything to the user's Image Library. If the user truly wants the post gone and the image retained for reuse, the future `deletePost` surface (D-S2-22 — reserved, not built in Stage-2) is the path.

### 2.3 Pro user deletes a cancelled batch from /create

User has a cancelled batch on `/create` with 5 posts (2 already cancelled before scheduling). User clicks `[Delete forever]`. Confirm dialog: "Delete this batch forever? The 5 images will move to your Image Library."

`postService.deleteBatchForever(userId, batchId)`:
1. Reads batch; confirms `userId === sessionUserId` AND `status === 'cancelled'`.
2. Reads all `posts.id` for the batch (5).
3. Reads `post_images.image_url` for those posts (5 URLs).
4. `imageService.retainImagesToLibrary(userId, postIds)`:
   - Acquires lock.
   - Counts library: 28. After insert: 33 → evict 3 oldest. For each eviction: `safeDeleteBlob` + delete row.
   - Inserts 5 new rows. Final count: 30.
   - Releases lock.
5. Deletes `weekly_batches` row. Cascade fires.
6. UI: card disappears from `/create`. Library shows `30/30 images`.

### 2.4 User deletes an image from /library

User opens `/library`, sees 30 tiles. Clicks `[Delete]` on tile #12. Confirm dialog: "Delete this image forever?"

`imageService.deleteLibraryImage(userId, libraryImageId)`:
1. Reads `library_images` row; confirms `userId === sessionUserId`.
2. Reads `imageUrl`.
3. `safeDeleteBlob(url)`.
4. Deletes `library_images` row.
5. Returns `{ ok: true }`. UI: tile disappears. Header now reads `29/30 images`.

### 2.5 Currently-posting batch on /create

User has a batch flipping through `in_progress` (Phase 7 future state). When the user lands on `/create`, the existing redirect path shows: `See the batch currently posting →` (was `Return to your current batch →`). Copy change only. Stage-2 does not produce `in_progress` from data; this is a Phase-7-dormant surface fix.

---

## 3. State → surface mapping (Stage-2)

| `weekly_batches.status` | Surface | Counts toward rolling-4? | Actions |
|---|---|---|---|
| `reviewing` | `/create` card | No | `[Open →]` → `/posts?batchId={id}` |
| `cancelled` | `/create` card | No | `[Open to reschedule →]` → `/posts?batchId={id}`; `[Delete forever]` → confirm dialog |
| `in_progress` | redirect on `/create` | No | `See the batch currently posting →` |
| `scheduling` | `/schedule` box + `/schedule/[id]` detail | **Yes** | Box: `[Cancel batch]`, `{N} posts` link; Detail: per-post `[Cancel]` |
| `completed` | `/schedule` box + `/schedule/[id]` detail | **Yes** | Read-only (no actions) |
| *(Phase-7 dormant)* `currently_posting` | `/schedule` emerald box | Yes | `[Cancel batch]` (with split block if `alreadyPostedCount > 0`) |

---

## 4. File and folder layout

```
src/
├── app/
│   └── (app)/
│       └── (onboarded)/
│           ├── create/
│           │   └── page.tsx                       MODIFIED — currently-posting copy
│           ├── library/
│           │   └── page.tsx                       MODIFIED — replace placeholder with functional grid
│           └── schedule/
│               ├── page.tsx                       MODIFIED — 2x2 grid + CTA + drop past batches
│               └── [batchId]/
│                   └── page.tsx                   NEW — detail page
├── components/
│   ├── create/
│   │   ├── unscheduled-batch-card.tsx             MODIFIED — chip + button copy + Delete forever
│   │   ├── delete-batch-forever-dialog.tsx        NEW — confirm dialog
│   │   └── currently-posting-cta.tsx              NEW — replaces "Return to your current batch"
│   ├── dashboard/
│   │   └── quota-countdown-pill.tsx               MODIFIED — re-anchor on scheduledBatchCount
│   ├── library/
│   │   ├── library-grid.tsx                       NEW — image tiles
│   │   └── library-image-delete-dialog.tsx        NEW — confirm dialog
│   ├── posts/
│   │   └── wizard-step.tsx                        MODIFIED — bulk Schedule button red fix
│   └── schedule/
│       ├── scheduled-page.tsx                     MODIFIED — 2x2 grid + drop past batches list
│       ├── scheduled-batch-box.tsx                MODIFIED — "N posts" link only (no strip — D-S2-12)
│       ├── create-next-batch-cta.tsx              NEW — capacity CTA above grid
│       ├── batch-detail-view.tsx                  NEW — /schedule/[batchId] body
│       ├── network-day-grid.tsx                   NEW — network × day matrix on the detail page (D-S2-15)
│       ├── batch-post-list-row.tsx                NEW — per-post row under the grid (text + per-post cancel)
│       └── cancel-post-dialog.tsx                 NEW — per-post cancel confirm
└── lib/
    ├── schema.ts                                  MODIFIED — add libraryImages table
    └── services/
        ├── image-service.ts                       NEW — retain/deletePermanently/list/delete
        ├── post-service.ts                        MODIFIED — cancelPost + deleteBatchForever + extend getScheduledViewForUser
        └── schedule-service.ts                    NEW — scheduleBatch + rolling-4 eviction

drizzle/
└── 000N_library_images.sql                        NEW — produced by `pnpm db:generate`

specs/scheduled-and-create-redesign-stage-2/
├── spec.md                                        THIS
├── action-required.md                             manual steps (db migrate, env vars)
├── verification.md                                NEW (Wave 6 deliverable)
└── tasks/
    ├── task-01..task-19                           one file per task
```

No other Drizzle tables touched. `post_images` schema unchanged.

---

## 5. Service-layer API

### 5.1 `library_images` schema (D-S2-4)

```ts
export const libraryImages = pgTable(
  "library_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    // Union: "ai" | "uploaded". No "library" value — this table IS the library.
    source: text("source").notNull(),
    // Audit-only: NO FK. The originating post is gone by the time we write here.
    originPostId: text("origin_post_id"),
    originBatchId: text("origin_batch_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Ordered scan for cap eviction (oldest-by-createdAt).
    index("library_images_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ]
);
export type LibraryImage = typeof libraryImages.$inferSelect;
export type NewLibraryImage = typeof libraryImages.$inferInsert;
```

### 5.2 `image-service.ts` (NEW)

```ts
type DeletionResult = { ok: true } | { ok: false; error: "not_found" | "not_owned" };

export async function retainImagesToLibrary(
  sessionUserId: string,
  postIds: string[],
): Promise<DeletionResult>;

export async function deleteImagesPermanently(
  sessionUserId: string,
  postIds: string[],
): Promise<DeletionResult>;

export async function listLibrary(
  sessionUserId: string,
): Promise<LibraryImage[]>;

export async function deleteLibraryImage(
  sessionUserId: string,
  libraryImageId: string,
): Promise<DeletionResult>;

// Internal — not exported.
async function safeDeleteBlob(url: string): Promise<void>;
```

**Multi-user safety contract (locked):** both `retainImagesToLibrary` and `deleteImagesPermanently` MUST reject the entire input when any `postId` resolves to a `posts` row whose `userId !== sessionUserId`. Return `{ ok: false, error: "not_owned" }` and perform no writes, no blob calls. **Silent filter-to-owned is forbidden** — a mixed-owner array is a caller bug, not a degradation case, and must fail loudly. Asserted in task-18 (scenario 5e).

**Ordering invariant** for both retain + permanent paths:
1. SELECT `image_url` rows from `post_images` joined to `posts` (verify `posts.userId === sessionUserId` for every row — reject the batch per the contract above if any row fails the check).
2. For `retainImagesToLibrary`: take `pg_advisory_xact_lock(hashtext('library:' || sessionUserId))`. Count `library_images`. Compute overflow `= count + postImages.length - 30`. If > 0, SELECT the oldest `overflow` rows by `createdAt`; call `safeDeleteBlob` for each; DELETE those rows. INSERT one new `library_images` row per `post_images` row (copying URL + prompt + source + origin* fields). Lock auto-releases at txn commit.
3. For `deleteImagesPermanently`: skip the lock + library work. Call `safeDeleteBlob` for each URL.
4. (Both paths) Caller deletes the `posts` (or `weekly_batches`) row(s). Cascade removes `post_images` and other dependents.

**`safeDeleteBlob(url)` reference impl:**
```ts
async function safeDeleteBlob(url: string): Promise<void> {
  try {
    await del(url);   // from @vercel/blob
  } catch (err) {
    console.error("[imageService.safeDeleteBlob]", err);
    await db.insert(postLogs).values({
      action: "blob_orphan",
      details: {
        url,
        reason: err instanceof Error ? err.message : "unknown",
      },
    }).catch(() => {});  // logging is best-effort too
  }
}
```

### 5.3 `post-service.ts` (MODIFIED)

**Extend `getScheduledViewForUser`** so that:
- `current` returns the most-recent 4 batches with `status IN ('scheduling', 'completed')` for the user, sorted by `createdAt DESC`. (Stage-1 returned only `scheduling` and windowed by the 30-day quota; Stage-2 uses rolling-4.)
- ~~Each `BatchBoxData` gains a `days[]` field~~ — **REMOVED in spec update.** The box no longer renders a per-day strip (see D-S2-12 + Wave-4 corrections at §0). Drop the `days[]` field from `BatchBoxData`, the `WEEKDAY_LABELS` + `DAY_MS` constants, the post-grouping by `postOrder`, and the day-strip-style `leftJoin(scheduledPosts)` from this function.
- **Counts under the Cancel-vs-Delete contract (§0) — PRESENT-DAY vs FUTURE-STATE.** This bullet was authored to mandate a `scheduled_posts`-backed reader. In Wave 4.5 we shipped that reader and it returned 0 everywhere because no writer populates `scheduled_posts` in production yet (Phase-4 cron is deferred per §0), so `/schedule` boxes regressed to `FB 0 · IG 0 · LI 0 · 0 posts` while `/create` kept the real selection-backed numbers. Wave 4.5.1 reverted the reader. The corrected contract:
  - **PRESENT DAY** — `getScheduledViewForUser` reads the **same sources** as `/create`'s `getUnscheduledBatchesForUser`: `BatchBoxData.totalPosts = weeklyBatches.totalPosts` (nominal column), `BatchBoxData.counts.{facebook|instagram|linkedin} = loadSelectionCounts(batchIds)` (`post_selections` aggregate). Both pages always agree because they share readers. The wizard freezes `post_selections` when a batch flips from `reviewing` → `scheduling`, so the selections accurately describe what the user opted into for the batches `/schedule` shows.
  - **FUTURE STATE** — when **both** preconditions land in a later wave: (1) a writer populates `scheduled_posts` rows when a batch transitions to `scheduling` (Phase-4 cron, or an explicit step inside `scheduleBatch`), AND (2) the cancel UI (task-15) can flip rows to `status='cancelled'` — swap the reader to a `scheduled_posts`-backed aggregate filtered to `status IN ('pending', 'posted')` (or equivalently, "selections except cancelled"). The future-state code should compute `BatchBoxData.totalPosts = COUNT(DISTINCT scheduled_posts.postId)` and `BatchBoxData.counts.* = COUNT(scheduled_posts) per (batchId, platform)`, both with the status filter. Until **both** preconditions hold, the spec-required reader is the present-day one above — do NOT re-introduce the `scheduled_posts`-backed reader against an empty table.
  - **Do not split this transition.** Switching only one precondition (e.g. shipping a `scheduled_posts` writer without the cancel UI, or vice versa) does not require a reader change either — the predicates remain equivalent until both ship. Switch the reader in the same wave that closes the second precondition.
- Stage-1's `past` array is dropped from the surface; the Past Batches disclosure is gone. Field can remain in the type with `[]` for backward-compat, or removed entirely if no other consumer reads it (preferred — kill dead surface).
- Add a new field `scheduledBatchCount: number` to `ScheduledView` — used by the pill (D-S2-10).

**Detail-page data path (independent).** `/schedule/[batchId]` (task-15) reads `weekly_batches` + `posts` + `scheduled_posts` directly to produce the network × day grid (D-S2-15). That path is independent of `getScheduledViewForUser` and is unaffected by the strip removal above — no data the grid needs is lost. (A future refactor may extract this into `postService.getBatchDetailForUser(sessionUserId, batchId)` for testability; not required by this spec update.)

**`cancelPost(sessionUserId, postId, platform?)`** (D-S2-6, D-S2-7) — **non-destructive status flip**:
1. SELECT `posts.userId, posts.batchId` WHERE `id = postId`. If none → `not_found`. If `userId !== sessionUserId` → `not_owned`.
2. SELECT `scheduled_posts.status, scheduled_posts.scheduledTime` for the chosen scope (filtered by `platform` when supplied; otherwise every row for the post). Apply the D-S2-7 gate: at least one row with `status='pending' AND scheduledTime > now()`, no row with `status='posted'`. Else → `already_posted`.
3. `UPDATE scheduled_posts SET status='cancelled' WHERE postId = ? AND status='pending'` (plus `AND platform = ?` when supplied). RETURNING the affected ids → `cancelledCount`.
4. Return `{ ok: true, batchId, cancelledCount }`.

**No DELETE, no cascade, NO call to `imageService.retainImagesToLibrary`.** The post family (posts + post_variations + post_selections + post_images) is preserved. Reversible via `restorePost`.

**`restorePost(sessionUserId, postId, platform?)`** (D-S2-21) — symmetric un-cancel:
1. SELECT `posts.userId, posts.batchId` WHERE `id = postId`. If none → `not_found`. If `userId !== sessionUserId` → `not_owned`.
2. SELECT `scheduled_posts.status, scheduled_posts.scheduledTime` for the chosen scope. Gate: at least one row with `status='cancelled' AND scheduledTime > now()`, no row with `status='posted'`. Else → `not_restorable`.
3. `UPDATE scheduled_posts SET status='pending' WHERE postId = ? AND status='cancelled'` (plus `AND platform = ?` when supplied). RETURNING the affected ids → `restoredCount`.
4. Return `{ ok: true, batchId, restoredCount }`.

No row insert. The `scheduled_posts` entries already exist with their original `scheduledTime`s; restore just reverses the status flip. No image movement (the image stayed attached through the cancel).

**`deletePost(sessionUserId, postId)`** (D-S2-22) — **RESERVED for a future spec; NOT implemented in Stage-2.** When built, will perform `imageService.retainImagesToLibrary(sessionUserId, [postId])` followed by `DELETE FROM posts WHERE id = postId AND userId = sessionUserId` (cascade fires, cleaning `post_images`, `post_variations`, `post_selections`, `scheduled_posts`). It is the path that will later trigger AI per-network regeneration. The name is reserved in this section so no destructive cancel path slips in under another name during the Wave 4.5 / Wave 5 work. See §8 deferred items.

**`deleteBatchForever(sessionUserId, batchId)`** (D-S2-8):
1. SELECT `weekly_batches.userId, weekly_batches.status` WHERE `id = batchId`. Guard: `userId === sessionUserId` AND `status === 'cancelled'`. Else `not_owned` / `not_cancelled`.
2. SELECT `posts.id` for the batch (could be 0 if user cancelled everything).
3. Call `imageService.retainImagesToLibrary(sessionUserId, postIds)` if postIds non-empty.
4. DELETE `weekly_batches.id = batchId`. Cascade.
5. Return `{ ok: true }`.

### 5.4 `schedule-service.ts` (NEW)

```ts
export async function scheduleBatch(
  sessionUserId: string,
  batchId: string,
): Promise<
  | { ok: true; batchId: string; evictedBatchId: string | null }
  | { ok: false; error: "not_found" | "not_owned" | "not_reviewing" }
>;
```

Behavior:
1. Status-guarded UPDATE: `set status='scheduling' where id=? and userId=? and status='reviewing'`. If 0 rows affected → `not_reviewing` (race-safe; matches `stopBatch` pattern).
2. SELECT COUNT(*) `weekly_batches` for user WHERE `status IN ('scheduling', 'completed')`. If `>= 5`, find the oldest by `createdAt`. Else `evictedBatchId = null`.
3. If evicting:
   - SELECT `posts.id` for the evicted batch.
   - `imageService.deleteImagesPermanently(sessionUserId, postIds)`.
   - DELETE the evicted `weekly_batches` row. Cascade.
4. Return `{ ok: true, batchId, evictedBatchId }`.

**Note on transactionality:** the schedule UPDATE and the eviction DELETE wrap in a single `db.transaction`. Blob calls happen OUTSIDE the txn (after step 1 commit-or-before-eviction-delete), because network calls in an open txn risk leak. Failure semantics:
- Steps 1 fails → user sees error toast, no state change.
- Step 3 (blob deletes) fail → orphans logged, txn continues to DELETE batch row.
- Step 3 DELETE fails → eviction is rolled back; the new batch's status flip stays. User now has 5 scheduled batches temporarily; next `scheduleBatch` (or a manual cleanup) will re-attempt eviction.

### 5.5 `subscription-service` — `scheduledBatchCount` exposure

Verify whether the existing `getProQuotaState()` or `checkSubscription()` exposes `scheduledBatchCount` (the count used by the pill — D-S2-10). If not, extend the snapshot. Plain count: `select count(*) from weekly_batches where userId=? and status in ('scheduling','completed')`. No 30-day window; no `periodStartDate` filter.

---

## 6. UI requirements

### 6.1 `<QuotaCountdownPill />` — re-anchor on scheduledBatchCount (D-S2-10)

Existing prop union from Stage-1:
```ts
type Props =
  | { variant: "trial"; used: boolean }
  | { variant: "starter"; batchesRemaining: number; nextResetAt: Date | null }
  | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date };
```

`batchesRemaining` semantics change for Pro: `4 - scheduledBatchCount`, not `4 - batchesUsedThisPeriod`. Starter remains `1 - batchesUsedThisPeriod` (unchanged — Starter doesn't have a rolling-4 concept; their cap is 1/period).

The pill caller (in the topbar) passes the new computed value from the snapshot. Hydration sentinel preserved as Stage-1 — only the rendered number changes.

### 6.2 `<UnscheduledBatchCard />` — copy + new action (D-S2-16)

Chip changes:
- `reviewing` → unchanged (`IN REVIEW`, champagne).
- `cancelled` → `CANCELLED` (drop the `— re-schedule` suffix; the affordance moves to the button label).

CTA changes:
- `reviewing` → unchanged (`Open →`).
- `cancelled` → `Open to reschedule →`.

New action on `cancelled` cards: secondary destructive `Delete forever` button, right of the primary CTA. Opens `<DeleteBatchForeverDialog />`.

### 6.3 `<DeleteBatchForeverDialog />` — new

```
┌─────────────────────────────────────────┐
│ Delete this batch forever?               │
├─────────────────────────────────────────┤
│ The batch and its posts will be removed. │
│ {N} images will move to your Image       │
│ Library so you can reuse them.           │
│                                          │
│              [Keep batch]  [Delete]      │
└─────────────────────────────────────────┘
```

Props: `batchId, imageCount, open, onOpenChange, onConfirm`. Submit calls `deleteBatchForever` via a server action; on success, success toast `"Batch deleted. {N} images saved to your Library."` and `revalidatePath('/create')`.

### 6.4 `<CurrentlyPostingCta />` — new wrapper / copy refresh (D-S2-17)

Replaces the existing `"Return to your current batch →"` text on `/create` when the user has an `in_progress` batch. Copy: `See the batch currently posting →`. Link target unchanged. Bare component swap — no behavior change.

### 6.5 `<ScheduledPage />` — 2x2 grid + drop past batches (D-S2-11, D-S2-13)

Layout:
```
container mx-auto px-5 sm:px-8 lg:px-12
  └── max-w-3xl mx-auto space-y-8
      ├── Header: "Scheduled"
      ├── <CreateNextBatchCta scheduledBatchCount={N} />     ← above the grid
      └── <BatchGrid />                                       ← 2x2 / 1-col mobile
```

`<PastBatchesList />` removed entirely from this page. Empty-state CTA when grid is empty preserved (Stage-1's `[Start a new batch →]` button — same copy).

### 6.6 `<CreateNextBatchCta />` — new (D-S2-13)

Single button, full width on mobile, `max-w-xs` on desktop. Label: `Create next batch — {scheduledBatchCount}/4`. Disabled at `4/4` with `<Tooltip>` reading `Schedule a new batch by cancelling or finishing one.` Links to `/create` when enabled. Uses `<Button variant="default" size="lg">` per DESIGN.md §9.

### 6.7 `<ScheduledBatchBox />` — clickable count (D-S2-14)

Stage-1 anatomy preserved (header strip → theme → counts → cancel). Single change:

1. The `{N} posts` text becomes `<Link href={`/schedule/${data.id}`} className="hover:underline text-foreground font-medium">{N} posts</Link>`.

The Cancel button stays for the `upcoming` and `currently_posting` variants — unchanged. **The 7-day strip insertion (originally task-13) is removed in this spec update — see Wave-4 corrections at §0 and D-S2-12.**

### 6.8 `<SevenDayStrip />` — REMOVED in spec update

The per-day strip on the Scheduled grid has been removed (see Wave-4 corrections at §0 and D-S2-12). `<SevenDayStrip />` and its data plumbing (`days[]` on `BatchBoxData`, the post-grouping in `getScheduledViewForUser`) are deleted. The per-day / per-network view now lives only on the detail page network × day grid — see §6.9 and D-S2-15.

### 6.9 `/schedule/[batchId]` page (D-S2-15)

Server-rendered. Fetches the batch (verify ownership) + its posts ordered by `postOrder` ASC + their `scheduled_posts` rows.

```
Header: ← Back to Scheduled  ·  BATCH {ordinal} · UPCOMING
Theme: {theme}
Important thing: {importantThing}

Network × Day grid (rows = networks, columns = days):

           Day 1   Day 2   Day 3   Day 4   ...   Day N
Facebook    ✓       ✓       ✗       ✓             ✓     ← clickable → jumps to #network-facebook
Instagram   ✓       ✓       ✗       ✓             ✓     ← clickable → jumps to #network-instagram
LinkedIn    ✓       ✗       ✗       ✓             ✓     ← clickable → jumps to #network-linkedin

  • Column count N = real batch length
    (`weeklyBatches.totalPosts`, equivalently `MAX(posts.postOrder)`).
    Pro batch 4 = 9 posts; NOT hardcoded to 7.
  • Cell is ✓ iff a `scheduled_posts` row exists for that
    (postId, platform) pair **with `status IN ('pending',
    'posted')`**. Otherwise ✗. `'cancelled'` rows count as
    absent (per Cancel-vs-Delete contract at §0). Truth source
    is `scheduled_posts` (status-filtered), NOT `posts`-row
    existence.
  • Column header carries the date / weekday derived from
    `MIN(scheduled_posts.scheduledTime)` across that post's networks
    (or a fallback `batch.createdAt + (ordinal - 1) days` when none
    of the post's networks have a `scheduled_posts` row yet).
  • Row order is fixed: Facebook → Instagram → LinkedIn today.
    Architected so new networks (Google Business Profile, X, …) can
    be appended as additional rows without restructuring.
  • **Each row is clickable.** Clicking a row (label + cells)
    jumps the page down to that network's section in the per-post
    list below — anchor link to `#network-{platform}`, NOT a
    filter (the rest of the page stays visible and unchanged).
    Rows render with `cursor-pointer`, a hover state (e.g.
    `bg-muted/60` lift), and visible `focus-visible:ring` so the
    affordance reads clearly for mouse + keyboard users. Preferred
    implementation is a native `<a href="#network-{platform}">`
    wrapping the row content (native scroll + keyboard focus +
    back-button parity); a button + `scrollIntoView({ behavior:
    'smooth', block: 'start' })` is acceptable. Respect
    `prefers-reduced-motion: reduce` per DESIGN.md §11 — when set,
    drop the smooth scroll and use an instant jump.

Per-post list (under the grid, GROUPED BY NETWORK):

  ## Facebook                         id="network-facebook"
  ┌──────────────────────────────────────────┐
  │ Day 1 — Mon Jun 03 · 9:00 AM             │
  │ "Spring blooms at Bonbonica — ..."       │
  │                              [Cancel]    │
  └──────────────────────────────────────────┘
  ┌──────────────────────────────────────────┐
  │ Day 2 — Tue Jun 04 · 9:00 AM             │
  │ "..."                                    │
  │                              [Cancel]    │
  └──────────────────────────────────────────┘
  ... (one row per post scheduled to Facebook)

  ## Instagram                        id="network-instagram"
  ┌──────────────────────────────────────────┐
  │ Day 1 — Mon Jun 03 · 9:05 AM             │
  │ "..."                                    │
  │                              [Cancel]    │
  └──────────────────────────────────────────┘
  ... (one row per post scheduled to Instagram)

  ## LinkedIn                         id="network-linkedin"
  ┌──────────────────────────────────────────┐
  │ Day 1 — Mon Jun 03 · 9:10 AM             │
  │ "..."                                    │
  │                              [Cancel]    │
  └──────────────────────────────────────────┘
  ... (one row per post scheduled to LinkedIn)

  • One section per network in the same fixed row order as the
    grid (Facebook → Instagram → LinkedIn today). Each section's
    container carries `id="network-{platform}"` to match the
    grid-row anchors above. New networks add a new section using
    the same template.
  • Inside a section, list every post with a `scheduled_posts`
    row for that platform, ordered by `postOrder` ASC. A post
    scheduled to multiple networks appears in each of its
    network sections — every section is the truth about what
    publishes to that network. NO post is hidden; this is
    grouping, not filtering.
  • Per-row time = the `scheduled_posts.scheduledTime` for THAT
    (postId, platform) pair (not the cross-network `MIN`). This
    surfaces the per-network offset (e.g. 9:00 / 9:05 / 9:10) so
    the user can see exactly when each network fires.
  • A post that exists but has no `scheduled_posts` row on any
    network (orphaned in Stage-2; rare) renders nowhere in the
    list — the grid row of ✗'s already tells the truth.
  • Missing posts (the user already cancelled them) render
    nowhere in any section. The grid column of ✗'s carries the
    "cancelled" signal; the list is the live-only view.
  • Per-post `[Cancel]` is shown on each row, gated by D-S2-7.
    Cancel is at the post level (whole post = all networks for
    that ordinal) — the Stage-2 UI calls `cancelPost(postId)`
    without a `platform` argument. When the user clicks
    `[Cancel]` from inside a network section, the dialog copy
    MUST make both the cross-network scope AND the retrievable
    nature explicit: e.g. *"Cancel this post? It will be
    unscheduled on every network it was set to publish on. You
    can restore it from this page later. The image stays
    attached — no image movement on cancel."* (Image-to-Library
    movement is a future-`deletePost` concern per D-S2-22.)
    Per-network cancel (passing `platform` to `cancelPost`) is
    available at the service layer but not surfaced in the
    Stage-2 UI — a later spec will decide the UI affordance.

Footer: [Cancel batch]
```

### 6.10 `<NetworkDayGrid />` + per-post list — new

`<NetworkDayGrid />` props: `{ posts: Array<{ id: string; postOrder: number; scheduledTimes: Record<Platform, Date | null> }>, networks: Platform[] }`. Renders an HTML `<table>` (or semantic grid) with one row per platform in `networks` and one column per post, ordered by `postOrder` ASC. Each cell renders ✓ iff `scheduledTimes[platform] !== null`, else ✗. Column header carries the day-of-week + date. Adding a network is a single push onto `networks`.

The per-post list below the grid is a sibling component (`<BatchPostListRow />`): one row per post — text + scheduled time + per-post `[Cancel]` (gated by D-S2-7 — hidden when the gate is closed). If a `posts` row is missing for an ordinal (e.g. already cancelled), the list row renders the "skipped" empty state (greyed, italic, "No post for this day").

> The old `<PostDaySlot />` from task-15.md is replaced by this two-component pair. Task-15 will be re-issued after this spec update is approved.

### 6.11 `<CancelPostDialog />` — new

Dialog confirming per-post cancel. Copy: `"Cancel this post? It will be unscheduled on every network it was set to publish on. You can restore it from this page later. The image stays attached."` Button: `[Cancel post]` (rendered as a non-destructive variant — DESIGN.md `outline` or `secondary`, NOT `destructive` — because the action is reversible). Submit calls `postService.cancelPost(postId)` (whole-post scope, no `platform` argument) via server action; on `already_posted`, error toast `"Already posted, can't cancel."` On success, success toast `"Post cancelled. Restore it from this page."` See Cancel-vs-Delete contract at §0 — this dialog is NOT the destructive delete surface (that's reserved as future-`deletePost`, D-S2-22).

### 6.12 `<LibraryPage />` (route `/library`) (D-S2-18)

Replaces Stage-1 placeholder. Layout: editorial pattern (DESIGN.md §8 B), `max-w-5xl` for the grid. Header: `Your image library` (Fraunces) + `{N}/30 images` (muted). Grid: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6`. Each tile: 1:1 image, `rounded-2xl`, hover-lift; bottom overlay reveals `[Delete]` button. Empty state: `"No images yet."`.

### 6.13 `<LibraryImageDeleteDialog />` — new

Confirm dialog with copy `"Delete this image forever?"` + `[Keep]` + `[Delete]`. Wires to `imageService.deleteLibraryImage`. Success toast: `"Image deleted."` Error toast (rare — only on cascade race): `"Image was already removed."`.

### 6.14 Wizard bulk Schedule button red fix (D-S2-19)

In `src/components/posts/wizard-step.tsx:160`, the `isAllSelected` branch sets `className={'size-4 text-destructive'}`. Change to a deeper warm-red specifically for dark mode (keep `text-destructive` on light). Implementation options:

```tsx
className={cn(
  "size-4",
  isAllSelected && "text-destructive dark:text-[oklch(0.62_0.18_30)]",
)}
```

Or via a new CSS utility in `globals.css`:
```css
.text-destructive-strong { color: oklch(0.5 0.17 30); }
@media (prefers-color-scheme: dark) {
  .text-destructive-strong { color: oklch(0.62 0.18 30); }
}
```

Pick the inline `cn` form unless additional surfaces need the same value.

---

## 7. Error handling

### 7.1 Per-post cancel — post already posted

`postService.cancelPost` returns `{ ok: false, error: 'already_posted' }` when D-S2-7's gate is closed. UI:
- Dialog stays open with inline `<p role="alert" className="text-destructive text-sm">Already posted, can't cancel.</p>` for 1s then dismisses.
- Surrounding state (the slot still shows the post; `/schedule` grid count unchanged) is correct — nothing was mutated. The `UPDATE` never ran because the gate caught the request before step 3 (per the cancelPost flow in §5.3).

### 7.2 Cancel batch already cancelled (existing)

Stage-1 contract preserved — `stopBatch` returns `not_scheduling`; UI shows the existing `"This batch was already cancelled."` toast.

### 7.3 Delete forever — concurrent race

User opens `/create` in two tabs, clicks `[Delete forever]` in both. First wins (`deleteBatchForever` returns `{ ok: true }`). Second sees `{ ok: false, error: 'not_found' }` and shows toast `"This batch was already removed."` then revalidates.

### 7.4 Library delete — image already gone

Same pattern: `deleteLibraryImage` returns `not_found`; UI toast `"Image was already removed."`.

### 7.5 Blob orphan logging

Every `safeDeleteBlob` failure writes one row to `post_logs`. Schema for `details`:
```ts
{ url: string; reason: string }
```
The future soft-delete spec's purge job will sweep these. No surfacing in Stage-2 UI.

### 7.6 30-cap concurrency

Per-user advisory xact lock (D-S2-5) serializes concurrent `retainImagesToLibrary` calls for the same user. No two retains can both see `count=30` and both insert.

### 7.7 Rolling-4 eviction partial failure

If the blob `del` for one evicted image fails, the row eviction still proceeds (`safeDeleteBlob` swallows the error). If the `delete from weekly_batches` itself fails (rare — DB error), the schedule UPDATE has already committed; user has 5 scheduled batches temporarily. Self-heals on the next `scheduleBatch` call.

---

## 8. What this spec deliberately does NOT cover

- **`deletePost(sessionUserId, postId)` — true per-post destructive action** (D-S2-22). Reserved name in this spec; not built. Future spec will: (a) retain the image to the Library, (b) `DELETE FROM posts` with cascade, (c) be the trigger surface for AI per-network regeneration. Until it ships, the Image Library fills only via `deleteBatchForever` (batch-level destruction).
- **Soft-delete trash + 30-day auto-purge for `deletePost`-removed content.** Stage-2's per-post cancel IS retrievable via `restorePost` (D-S2-21) — that covers the reversibility half of the original trash concept. The future spec covers true-`deletePost` recovery + automatic purge after N days.
- **Per-network cancel UI affordance.** Service layer supports it (`cancelPost(postId, platform)` — D-S2-6); Stage-2 UI surfaces only whole-post cancel. A later spec will decide the UI.
- Google Business Profile + X as additional networks.
- Drag-to-reorder posts.
- Phase 7 posting service (OAuth + publishers).
- Phase 4 cron auto-scheduler (`scheduleBatch` is user-initiated only).
- `subscription.periodStartDate` semantics. The pill re-anchors on `scheduledBatchCount`, not the 30-day window. The column stays unchanged.
- Wider DESIGN.md repaint. Only the wizard bulk-Schedule checked icon's dark-mode color changes.
- Image upload UI to `/library`. Stage-2 populates the Library only via retention paths. Direct uploads come later.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Blob `del` failures silently accumulate orphans | All failures logged to `post_logs` with structured details. Manual sweep + future purge job both have visibility. |
| Per-user advisory lock contention on Library writes | Stage-2 scale: ≤ 4 batches × 7 posts = 28 cancellations max per user. Lock is per-`userId`, sub-millisecond hold. No contention modeled. |
| Rolling-4 eviction during traffic spike | Single guarded UPDATE + single DELETE per schedule action. Blob calls are sequential but bounded (≤ 7 per evicted batch). Worst case Schedule click takes ~2s on a degraded Vercel Blob. Acceptable. |
| User cancels a post mid-cron (race) | D-S2-7 gate re-checks `scheduled_posts.status` inside the cancel. Cron writes `status='posted'` atomically. If cron wins, cancel returns `already_posted`. If cancel wins, cron's per-row `where status='pending'` UPDATE returns 0 rows. Phase-7 work confirms the cron pattern. |
| 30-image Library cap surprises users | Header text `{N}/30 images` makes the cap visible at all times. Eviction toast: `"Oldest image replaced to make room."` |
| User-isolation regression | Explicit wave-6 test suite asserts User-A's cancel/schedule/delete never touches User-B's rows. Service-layer guards are the contract; tests are the verification. |
| Wizard bulk Schedule button red change breaks Stage-1 UX in light mode | `dark:` prefix scopes the deepening. Existing light-mode coral untouched. |

---

## 10. Definition of done

- [ ] `library_images` table added; migration generated + applied locally. No `pnpm db:push` used.
- [ ] `imageService` exports `retainImagesToLibrary`, `deleteImagesPermanently`, `listLibrary`, `deleteLibraryImage`. URL-read-first ordering enforced. `safeDeleteBlob` swallows errors and logs orphans.
- [ ] `postService.cancelPost(sessionUserId, postId, platform?)` shipped as a non-destructive `UPDATE scheduled_posts SET status='cancelled'` per D-S2-6 / D-S2-7. **Does NOT call `retainImagesToLibrary`** (image stays attached because the post stays). `scheduled_posts.status` union extended to include `'cancelled'`.
- [ ] `postService.restorePost(sessionUserId, postId, platform?)` shipped as the symmetric un-cancel per D-S2-21.
- [ ] `postService.deletePost` is **RESERVED only** (D-S2-22) — not built in Stage-2. No competing destructive cancel path exists.
- [ ] `postService.deleteBatchForever` shipped with the D-S2-8 contract (image-preservation + cascade); unchanged from earlier draft.
- [ ] Readers respect the Cancel-vs-Delete contract: network × day grid cells = ✓ iff `scheduled_posts` row exists for `(postId, platform)` with `status IN ('pending', 'posted')`; `getScheduledViewForUser` per-network counts and box `{N} posts` total exclude `'cancelled'` rows.
- [ ] `scheduleService.scheduleBatch` shipped with rolling-4 eviction (D-S2-2) and the `evictedBatchId` return shape.
- [ ] `getScheduledViewForUser` returns the rolling-4 list + `scheduledBatchCount`. No `days[]` field (spec update — see Wave-4 corrections at §0); no `scheduled_posts` join in this function.
- [ ] `<QuotaCountdownPill />` re-anchored on `scheduledBatchCount`. Trial unchanged.
- [ ] `/create` cancelled cards: chip = `CANCELLED`; CTA = `Open to reschedule →`; secondary `Delete forever` action wired to `deleteBatchForever`.
- [ ] `/create` `in_progress` copy: `See the batch currently posting →`.
- [ ] `/schedule`: 2x2 grid; Past Batches disclosure gone; `[Create next batch — N/4]` CTA above grid (disabled at 4/4 with tooltip).
- [ ] `<ScheduledBatchBox />`: no per-day strip; `{N} posts` is a link to `/schedule/[batchId]`.
- [ ] `/schedule/[batchId]` page exists; shows a **network × day grid** sized to the real batch length (rows = networks, columns = days, cell = ✓ iff a `scheduled_posts` row exists for that `(postId, platform)` pair); per-post list below the grid; per-post cancel works subject to D-S2-7 gate.
- [ ] `/library` page: grid + `{N}/30 images` header + per-tile delete with confirm.
- [ ] Wizard bulk Schedule button checked-icon: deeper red in dark mode; warm-palette compliant; light mode unchanged.
- [ ] User-isolation regression tests (wave-6) prove cross-user safety on `cancelPost`, `restorePost`, `deleteBatchForever`, `scheduleBatch`, `deleteLibraryImage`.
- [ ] Wave-6 verification runbook (`verification.md`) PASSed.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` all exit 0.

---

## 11. After sign-off

19 tasks across 6 waves. Within-wave parallelism per the table:

| Wave | Tasks | Launch order | Description |
|---|---|---|---|
| 1 | 01, 02 | **Batch A:** 01, 02 (parallel — different files) | Foundation: Drizzle migration + read-only service extension. |
| 2 | 03, 04, 05, 06 | **Batch A:** 03, 06 (parallel). **Then Batch B:** 04 alone. **Then Batch C:** 05 alone. | Tasks 04 + 05 both modify `post-service.ts` — never co-launched. A `Depends on:` note in a task file does not guarantee an agent waits; orchestrate the wait in the launcher. |
| 3 | 07, 08, 09, 10 | **Batch A:** 07, 09, 10 (parallel). **Then Batch B:** 08 alone. | Task 08 re-edits `unscheduled-batch-card.tsx` after task 07's copy fixes land + needs task 05's service. |
| 4 | 11, 12, 13, 14 | **Batch A:** 11, 12, 13 (parallel). **Then Batch B:** 14 alone. | Task 14 re-edits `scheduled-batch-box.tsx` after task 13 inserts the 7-day strip. *Spec-update note: the strip from task-13 is removed in a follow-up Wave 4.5 corrective code wave (see Wave-4 corrections + Cancel-vs-Delete contract at §0). Wave 4.5 also refactors `cancelPost` to the non-destructive status flip (D-S2-6 / D-S2-21), extends `scheduled_posts.status` to include `'cancelled'`, and re-filters readers — task-14's `{N} posts` link remains.* |
| 5 | 15, 16 | **Batch A:** 15, 16 (parallel — different routes) | Detail page (**network × day grid sized to real batch length** — D-S2-15) + Library page. Task-15 to be re-issued after this spec update is approved, against the new `cancelPost` + `restorePost` contracts; task-16 unchanged (Library still ships, just with fewer inputs until `deletePost` exists per D-S2-22). |
| 6 | 17, 18, 19 | **Batch A:** 17 alone. **Then Batch B:** 18 alone. **Then Batch C:** 19 alone. | Sequential: 17 must land before 18 audits; 18 must PASS before 19 runs the E2E. |

> **Orchestration rule for `/implement-feature`:** when a wave row lists multiple batches, complete a batch (all parallel agents reported back) before launching the next. Do not rely on `Depends on:` metadata to serialize same-batch agents — the launcher enforces serialization, not the agents.
