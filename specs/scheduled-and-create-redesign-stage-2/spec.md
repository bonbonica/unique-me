# Scheduled & Create Posts Redesign — Stage 2

Stage 1 (UI-only, sidebar + cards + dormant contracts) shipped at `specs/scheduled-and-create-redesign/`. Stage 2 wires real behavior on top: rolling-4 batch retention, hard-deletes with image preservation, an Image Library, per-post cancel, and small UI fixes.

## 0. Status of items flagged this revision

### Resolved (locked into the spec body)

- **Rolling-4 counting basis** = `weekly_batches.status IN ('scheduling', 'completed')`. Cancelled and reviewing batches do NOT eat a rolling-4 slot — they live on `/create` as cards. Slot consumption happens at the **schedule action**, not at generation.
- **Image Library** lives in a new `library_images` table, capped at 30 per user (rolling, oldest-by-`createdAt` evicts). `library_images` survives parent-post deletion; `post_images` is for the attached-to-a-post case.
- **Image-service helper** (`src/lib/services/image-service.ts`) is the single orchestrator for blob lifecycle. All deletion paths go through it. Order is invariant: **read URL → blob `del()` → DB row removal.** Blob failures log to `post_logs.action='blob_orphan'` and never block the caller.
- **Per-post cancel** = hard-delete the post, preserve its image to `library_images` first. Available until the post's `scheduled_posts.scheduledTime > now()` AND no `scheduled_posts.status='posted'` exists. No undo until the future soft-delete spec.
- **Delete-forever** on a cancelled card = hard-delete the batch, preserve images. Same retention rule. Available on `status='cancelled'` only.
- **Schedule page redesign**: 2x2 grid (max 4 boxes), single column on mobile, drops the Stage-1 Past Batches disclosure. `[Create next batch — N/4]` CTA above the grid; each box gets a 7-day calendar strip + a clickable "N posts" link.
- **`/schedule/[batchId]` detail page** (new) renders 7 ordered day-slots with per-post cancel controls. Cancelled posts leave the slot empty/skipped (no compaction).
- **`/library`** becomes a functional page (was Stage-1 placeholder).
- **Top pill** re-anchored: `N batches left` while `scheduledBatchCount < 4`; `Resets in Nd` at `scheduledBatchCount === 4`. Cancelled cards on `/create` don't deduct. Trial/Starter pill behavior unchanged.
- **Cancelled card copy fixes**: chip becomes plain `CANCELLED`; CTA becomes `Open to reschedule →`; new destructive `Delete forever` action.
- **`in_progress` /create copy** updates from `Return to your current batch →` to `See the batch currently posting →`.
- **Wizard bulk Schedule button checked-icon** — deepen the dark-mode red so the "scheduled" affirmation reads at a glance. Stays in the warm palette per DESIGN.md (no pure crimson). Light mode unchanged.
- **User-isolation contract**: every service-layer write enforces `userId === sessionUserId` at row read time. Explicit regression tests assert User-A actions never touch User-B's data.
- **All deletions are synchronous** at action time (user preference). No background jobs.

### Items deliberately deferred (future specs, named so they don't sneak in)

- **Soft-delete trash + restore + 30-day auto-purge** for posts. Stage-2's per-post cancel has no undo — that's acceptable because images survive in the Library. The future spec will reuse `image-service.ts` for its purge job.
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
| **D-S2-6** | `postService.cancelPost(sessionUserId, postId)` is the single API for per-post cancel. Behavior: read `post_images.image_url` for the post → preserve to `library_images` (subject to D-S2-5) → delete `posts` row (cascade cleans `post_images`, `post_variations`, `post_selections`, `scheduled_posts`). Image blob stays alive — `library_images.imageUrl` now owns it. |
| **D-S2-7** | Per-post cancel availability gate = the post has at least one `scheduled_posts` row with `scheduledTime > now()` AND NO `scheduled_posts` row with `status='posted'`. Else `cancelPost` returns `already_posted` and the UI toast says "Already posted, can't cancel." |
| **D-S2-8** | `postService.deleteBatchForever(sessionUserId, batchId)` is available only on `weekly_batches.status='cancelled'`. Image-preservation rule mirrors D-S2-6 (per-post, per-image). Reviewing batches use the existing wizard discard flow — not this surface. |
| **D-S2-9** | Image-service primitive `safeDeleteBlob(url)`: calls `del(url)` from `@vercel/blob`; catches any error; logs `post_logs.action='blob_orphan'` on failure with `details: { url, reason }`; never throws. Used by both `retainImagesToLibrary` (for eviction during cap overflow) and `deleteImagesPermanently` (for rolling-4 batch purge). |
| **D-S2-10** | Top pill (Starter/Pro). Under cap (`scheduledBatchCount < 4`): `{N} batches left` where `N = 4 - scheduledBatchCount`. At cap (`=== 4`): `Resets in {N}d`. Trial pill unchanged from Stage-1 D-S12. The Stage-2 in-page CTA (D-S2-13) covers in-page capacity display; the pill is not duplicated there. |
| **D-S2-11** | `/schedule` renders a 2x2 grid for up to 4 boxes (`scheduling + completed`), sorted by `createdAt DESC`. Single column on mobile (`grid-cols-1 md:grid-cols-2`). The Stage-1 Past Batches disclosure is removed (the rolling-4 IS the history). Empty state copy unchanged from Stage-1. |
| **D-S2-12** | Each `<ScheduledBatchBox />` renders a 7-day calendar strip between the title strip and the network counts row. Data: `BatchBoxData.days: Array<{ label: string; date: Date; status: 'scheduled' \| 'cancelled' \| 'posted' }>`. Stage-2 produces `'scheduled'` (✓) and `'cancelled'` (✗ / empty). `'posted'` is the Phase-7 dormant contract value. 7 cells always, derived from `posts.postOrder` 1..7 — slots persist after cancellation (no compaction). |
| **D-S2-13** | `[Create next batch — N/4]` CTA renders above the 2x2 grid on `/schedule`. Disabled at `4/4` with tooltip `"Schedule a new batch by cancelling or finishing one."` Links to `/create`. |
| **D-S2-14** | Each box's `{N} posts` text becomes a `<Link>` to `/schedule/[batchId]`. |
| **D-S2-15** | `/schedule/[batchId]` (new page) renders 7 ordered day slots from `posts.postOrder`. Each slot: day-of-week label + scheduled time + post text preview + per-post `[Cancel]` (hidden when the cancel gate per D-S2-7 is closed). Page footer keeps the existing `[Cancel batch]` action. |
| **D-S2-16** | `/create` cancelled card: chip text = `CANCELLED` (no `— re-schedule`). Primary CTA = `Open to reschedule →`. Secondary destructive action = `Delete forever` (opens confirm dialog explaining image preservation). |
| **D-S2-17** | `/create` `in_progress` redirect copy = `See the batch currently posting →` (was `Return to your current batch →`). No behavior change; copy only. |
| **D-S2-18** | `/library` renders the user's `library_images` rows, newest-first, in a responsive grid. Header text: `{N}/30 images`. Each tile has a destructive `[Delete]` action → confirm dialog → `imageService.deleteLibraryImage`. |
| **D-S2-19** | Wizard bulk Schedule button (in `wizard-step.tsx:160`) checked-state icon — deepen the dark-mode red toward `oklch(0.62 0.18 30)` (rust/coral, still in the warm family per DESIGN.md). Light mode value unchanged (the dark-mode pale coral is the surface that fails). Only the icon `text-*` class flips on `isAllSelected`; surrounding chrome unchanged. |
| **D-S2-20** | New Drizzle migration required for `library_images`. Run `pnpm db:generate` to produce the SQL, then `pnpm db:migrate` to apply locally. **Never `pnpm db:push`.** The migration commits to `drizzle/` with the next sequential number. |

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

`postService.cancelPost(userId, post4.id)` runs:
1. Reads `posts` row, confirms `userId === sessionUserId`.
2. Reads `scheduled_posts` rows for post4. Confirms `scheduledTime > now()` and no row has `status='posted'`. (If either fails, returns `already_posted` and the UI shows a toast.)
3. Reads `post_images.image_url` for post4 (≤ 1 row).
4. `imageService.retainImagesToLibrary(userId, [post4.id])`:
   - Acquires `pg_advisory_xact_lock(hashtext('library:' || userId))`.
   - Counts user's `library_images`. Result: 0.
   - Inserts new `library_images` row copying URL + prompt + source from `post_images`.
   - Releases lock.
5. Deletes `posts.id = post4.id`. Cascade removes the now-orphaned `post_images` row (blob URL is now owned by `library_images`), `post_variations`, `post_selections`, `scheduled_posts`.
6. Returns `{ ok: true }`. UI updates: slot #4 on the detail page is empty/skipped; box on `/schedule` shows 6 ✓ + 1 ✗ on its 7-day strip; `{6} posts` text reflects truth.

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
│       ├── scheduled-batch-box.tsx                MODIFIED — 7-day strip + "N posts" link
│       ├── create-next-batch-cta.tsx              NEW — capacity CTA above grid
│       ├── seven-day-strip.tsx                    NEW — calendar strip subcomponent
│       ├── batch-detail-view.tsx                  NEW — /schedule/[batchId] body
│       ├── post-day-slot.tsx                      NEW — single day row
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
- Each `BatchBoxData` gains a `days: Array<{ label: string; date: Date; status: 'scheduled' | 'cancelled' | 'posted' }>` field derived from the batch's `posts` joined to `scheduled_posts.scheduledTime` (earliest scheduledTime per post; `label` is the short weekday like "Mon"). Stage-2 produces `'scheduled'` (post exists, no posted scheduled_posts) and `'cancelled'` (no post for that ordinal because cancelled). `'posted'` is dormant.
- Stage-1's `past` array is dropped from the surface; the Past Batches disclosure is gone. Field can remain in the type with `[]` for backward-compat, or removed entirely if no other consumer reads it (preferred — kill dead surface).
- Add a new field `scheduledBatchCount: number` to `ScheduledView` — used by the pill (D-S2-10).

**`cancelPost(sessionUserId, postId)`** (D-S2-6, D-S2-7):
1. SELECT `posts.userId, posts.batchId` WHERE `id = postId`. If none → `not_found`. If `userId !== sessionUserId` → `not_owned`.
2. SELECT `scheduled_posts.status, scheduled_posts.scheduledTime` for the post. If any row has `status='posted'`, OR all rows have `scheduledTime <= now()` → `already_posted`.
3. Call `imageService.retainImagesToLibrary(sessionUserId, [postId])`.
4. DELETE `posts.id = postId`. Cascade.
5. Return `{ ok: true, batchId }`.

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

### 6.7 `<ScheduledBatchBox />` — 7-day strip + clickable count (D-S2-12, D-S2-14)

Stage-1 anatomy preserved (header strip → theme → counts → cancel). Two changes:

1. Insert `<SevenDayStrip days={data.days} />` between the title strip and the network-counts row.
2. The `{N} posts` text becomes `<Link href={`/schedule/${data.id}`} className="hover:underline text-foreground font-medium">{N} posts</Link>`.

The Cancel button stays for the `upcoming` and `currently_posting` variants — unchanged.

### 6.8 `<SevenDayStrip />` — new

```
M  T  W  T  F  S  S
✓  ✓  ✗  ✓  ✓  ✓  ✓
```

Cells: 7 fixed slots, gap-3, `text-xs text-muted-foreground` for day labels; cell state below — `text-primary` for `scheduled` (✓), `text-destructive` (or muted ✗) for `cancelled`. Dormant `posted` value: emerald (Phase-7 contract). Strip is purely presentational — no clicks.

### 6.9 `/schedule/[batchId]` page (D-S2-15)

Server-rendered. Fetches the batch (verify ownership) + its posts ordered by `postOrder` ASC + their `scheduled_posts` rows.

```
Header: ← Back to Scheduled  ·  BATCH {ordinal} · UPCOMING
Theme: {theme}
Important thing: {importantThing}

Day slots (7):
┌──────────────────────────────────────────┐
│ Mon Jun 03  ·  9:00 AM                   │
│ "Spring blooms at Bonbonica — ..."       │
│ FB · IG · LI                             │
│                              [Cancel]    │
└──────────────────────────────────────────┘
... (or skipped slot: greyed out, label only, no body)

Footer: [Cancel batch]
```

### 6.10 `<PostDaySlot />` — new

Renders one row. Props: `{ postOrder, post: { id, postText, hashtags } | null, networks: Platform[], scheduledTime: Date | null, canCancel: boolean, onCancel: () => void }`. If `post === null` → render the "skipped" empty state (greyed, italic, "No post for this day").

### 6.11 `<CancelPostDialog />` — new

Dialog confirming per-post cancel. Copy: `"Cancel this post? It will be removed from the batch. The image moves to your Image Library."` Button: `[Cancel post]`. Submit calls `postService.cancelPost` via server action; on `already_posted`, error toast `"Already posted, can't cancel."`

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
- Surrounding state (the slot still shows the post; `/schedule` grid count unchanged) is correct — nothing was deleted.

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

- Soft-delete trash + restore + 30-day auto-purge. Per-post cancel has no undo until that lands.
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
- [ ] `postService.cancelPost` and `deleteBatchForever` shipped with the D-S2-6 / D-S2-7 / D-S2-8 contracts; both call `retainImagesToLibrary`.
- [ ] `scheduleService.scheduleBatch` shipped with rolling-4 eviction (D-S2-2) and the `evictedBatchId` return shape.
- [ ] `getScheduledViewForUser` returns the rolling-4 list + `days[]` per box + `scheduledBatchCount`.
- [ ] `<QuotaCountdownPill />` re-anchored on `scheduledBatchCount`. Trial unchanged.
- [ ] `/create` cancelled cards: chip = `CANCELLED`; CTA = `Open to reschedule →`; secondary `Delete forever` action wired to `deleteBatchForever`.
- [ ] `/create` `in_progress` copy: `See the batch currently posting →`.
- [ ] `/schedule`: 2x2 grid; Past Batches disclosure gone; `[Create next batch — N/4]` CTA above grid (disabled at 4/4 with tooltip).
- [ ] `<ScheduledBatchBox />`: 7-day strip rendered between header and counts; `{N} posts` is a link to `/schedule/[batchId]`.
- [ ] `/schedule/[batchId]` page exists; shows 7 day slots; per-post cancel works subject to D-S2-7 gate.
- [ ] `/library` page: grid + `{N}/30 images` header + per-tile delete with confirm.
- [ ] Wizard bulk Schedule button checked-icon: deeper red in dark mode; warm-palette compliant; light mode unchanged.
- [ ] User-isolation regression tests (wave-6) prove cross-user safety on `cancelPost`, `deleteBatchForever`, `scheduleBatch`, `deleteLibraryImage`.
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
| 4 | 11, 12, 13, 14 | **Batch A:** 11, 12, 13 (parallel). **Then Batch B:** 14 alone. | Task 14 re-edits `scheduled-batch-box.tsx` after task 13 inserts the 7-day strip. |
| 5 | 15, 16 | **Batch A:** 15, 16 (parallel — different routes) | Detail page + Library page. |
| 6 | 17, 18, 19 | **Batch A:** 17 alone. **Then Batch B:** 18 alone. **Then Batch C:** 19 alone. | Sequential: 17 must land before 18 audits; 18 must PASS before 19 runs the E2E. |

> **Orchestration rule for `/implement-feature`:** when a wave row lists multiple batches, complete a batch (all parallel agents reported back) before launching the next. Do not rely on `Depends on:` metadata to serialize same-batch agents — the launcher enforces serialization, not the agents.
