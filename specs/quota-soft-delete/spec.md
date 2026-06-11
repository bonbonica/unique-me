# Quota-integrity soft-delete — spec

## Context

Three subscription gates enforce per-period batch limits:

- **Trial** — 1 batch lifetime.
- **Starter** — 1 batch per rolling 7 days.
- **Pro** — 4 batches per rolling 30-day period.

All three are derived from live SQL queries against `weekly_batches` (no stored counter). When the Stage-2 cancel-vs-delete redesign (`D-S2-8`) shipped, it introduced a hard-delete path — `deleteBatchForever` — for image-preservation reasons. That hard-delete silently refunds the consumed slot, because the gate queries see "row count = N-1" / "no row exists" / "most-recent batch is older" after the row vanishes.

Reproducer (confirmed during testing): a Pro user fills 4/4 slots in a period → cancels them → deletes all four → app allows 4 fresh generations in the same period. Trial and Starter have the equivalent bypass via the same mechanism.

The hard-delete violates a documented invariant — `D-A16` at `src/lib/services/subscription-service.ts:296-299`: cancelled / scheduled / completed batches all consume a slot. The invariant assumed batches never disappeared; the Stage-2 redesign broke it.

## Fix overview — Option 1, soft delete

Add a `deleted_at` timestamp column to `weekly_batches`. Change `deleteBatchForever` to set `deleted_at = now()` instead of issuing `DELETE FROM weekly_batches`. The batch row stays. Quota gates continue to query as-is (no `deleted_at` filter), so a soft-deleted batch still consumes its slot. User-facing list/read surfaces gain a `WHERE deleted_at IS NULL` filter so soft-deleted batches vanish from every list the user sees.

Image preservation (Vercel Blob retention via `imageService.retainImagesToLibrary`) is unchanged. Child rows on `posts`, `post_images`, `post_variations`, `post_selections`, and `scheduled_posts` are still removed — only the batch row is preserved (see §3).

## 1. Data model

### New column

| Table | Column | Type | Nullable | Default | Index |
|---|---|---|---|---|---|
| `weekly_batches` | `deleted_at` | `timestamp` | yes | `NULL` | none |

`NULL` = "live row." Non-NULL = "soft-deleted at that moment." All existing rows stay `NULL` after migration — soft-delete is a forward-only signal; no data backfill required.

Indexing is intentionally skipped in this wave — the column is read on hot paths (`/create`, `/schedule`) but each per-user query already filters on `user_id` first, and the row count per user is small (≤ 4 active + a handful of tombstones in practice). Revisit if EXPLAIN shows a sequential-scan regression after the wave ships.

### Migration

- `pnpm db:generate` followed by `pnpm db:migrate` per `AGENTS.md`. Never `db:push`.
- The migration SQL file ships with the wave's commit.

## 2. Quota gates — confirm soft-deleted rows still count

The three gates inside `subscription-service.ts` MUST continue to count soft-deleted rows. None of them should add a `deleted_at` filter. The whole fix hinges on them seeing tombstones as still-consuming-a-slot.

| Gate | Query | File:line | Action |
|---|---|---|---|
| Trial — existence | `db.query.weeklyBatches.findFirst` | `subscription-service.ts:410-413` | **No change.** Counts soft-deleted rows by virtue of not filtering. |
| Starter — most-recent | `getMostRecentBatchInternal` — `ORDER BY createdAt DESC LIMIT 1` | `subscription-service.ts:699-710` | **No change.** Returns the soft-deleted row if it's the newest. The 7-day window keys off its `createdAt`. |
| Pro — count over period | `getProQuotaState` — `count(*)` over rolling window | `subscription-service.ts:301-335` | **No change.** Counts every row in the period regardless of `deleted_at`. |

These three queries are the integrity guarantee. The verification plan (§6) re-asserts each.

## 3. Delete flow — `deleteBatchForever`

Current implementation at `src/lib/services/post-service.ts:1749-1822`:

1. Ownership + status gate (`status = 'cancelled'` required).
2. Read child `posts.id`s for image preservation.
3. `imageService.retainImagesToLibrary(...)` — copies blob references into `library_images`.
4. `db.delete(weeklyBatches).where(...)` — hard DELETE; cascade fires through `posts → post_images → post_variations → post_selections → scheduled_posts`.

After the fix:

1. Unchanged.
2. Unchanged.
3. Unchanged.
4. **Two-step transaction**:
   - DELETE the child rows explicitly, in cascade order (`scheduled_posts`, `post_selections`, `post_variations`, `post_images`, then `posts` — bottom-up so foreign keys release cleanly). Image blobs are already preserved by step 3, so deleting `post_images` is safe.
   - UPDATE the `weekly_batches` row: `SET deleted_at = now()` with race-guard `WHERE id = ? AND user_id = ? AND status = 'cancelled' AND deleted_at IS NULL`. The `deleted_at IS NULL` clause is load-bearing: a second delete call on an already-soft-deleted batch finds zero matching rows, the UPDATE returns `0`, and the function surfaces the existing `not_found` error variant. A re-call MUST NOT re-stamp `deleted_at` — `deleted_at` records the *first* moment of deletion and stays frozen after that.

The function's return type and error union are unchanged. No new error variants.

### Why explicit child-row deletion instead of leaving the children

The user-visible behavior we're preserving is "deleted batches vanish from the UI but still count toward the quota." Child rows aren't user-visible and aren't read by the gates, so leaving them would accumulate dead rows behind every soft-deleted batch. Explicit deletion in the same transaction matches today's cascade behavior — only the parent row survives as a tombstone.

## 4. User-facing read surfaces — add `deleted_at IS NULL` filter

Every read that returns batches the user might see, click, or count in a UI label must filter out soft-deleted rows. Inventory based on the current `src/lib/services/post-service.ts`:

| Surface | Reader | File:line | Action |
|---|---|---|---|
| `/create` unscheduled batch cards | `getUnscheduledBatchesForUser` | `post-service.ts:512-556` | Add `AND deleted_at IS NULL` to the main SELECT. |
| `/schedule` 2×2 boxes (Stage-2) | `getScheduledViewForUser` | `post-service.ts:609-677` | Same. |
| `/schedule/[batchId]` detail page | `getBatchForReview` | `post-service.ts:694-767` | Add the filter to the initial batch SELECT. A soft-deleted batch returns `null` from this function (same shape as `not_found`). |
| `/posts` no-arg fallback ("resume") | `getResumableBatch` | `post-service.ts:304-325` | Add `AND deleted_at IS NULL`. |
| In-flight batch read | `getCurrentBatch` | `post-service.ts:267-283` | Same. |
| Trial gated-screen deep-link target | `getMostRecentBatch` | `post-service.ts:428-439` | Same. |
| `<CurrentlyPostingCta />` resolver | `getCurrentlyPostingBatch` | `post-service.ts:378-419` | Both code paths — the ordinal-keyed Pro lookup and the FIFO fallback — get the filter. |

### Read surfaces that must NOT filter

| Surface | Reader | File:line | Rationale |
|---|---|---|---|
| `/create` form-vs-gate decision (trial) | `hasAnyBatch` | `post-service.ts:251-257` | Trial gating semantically means "has the user ever consumed their lifetime allowance?" — soft-deleted batches still count, so this MUST keep returning `true` for users whose only batch is soft-deleted. Confirm via grep that this function is only consumed by trial-gate / has-profile paths before shipping. |

### Other surfaces — confirm during implementation

- **Library** (`/library`) — image-service backed; reads `library_images`, not `weekly_batches`. No change expected.
- **Dashboard / TopBar pill / NextBatchBanner** — read derived numbers from `subscriptionService.checkSubscription`, which routes through `getProQuotaState`. Soft-deleted rows still count → displayed numbers stay correct → no component change required.

Implementation must grep the repo for every direct read of `weeklyBatches` (`from(weeklyBatches)`, `findFirst({ where: ... weeklyBatches ... })`, `db.select(... weeklyBatches)`) and audit each call site against this inventory. Anything missing either needs the filter added (user-visible) or needs an explicit comment justifying the omission (gate / counter logic).

## 5. Out of scope

Explicitly NOT in this wave:

- No "trash" / "recently deleted" UI view.
- No restore action.
- No 30-day or N-day purge job to hard-delete old tombstones.
- No retroactive cleanup. Batches hard-deleted before this fix shipped are gone; their refunded slots are not reclaimed. The fix is forward-only.
- No copy change on the delete confirmation dialog. Existing copy is fine — the behavior is what the user already mentally models ("delete this batch from my view").

Any of these can come later as a follow-up spec if storage or UX requires.

## 6. Acceptance

Manual verification — mirrors the bug repro plus the new must-not-regress invariants.

| Check | How |
|---|---|
| Pro 4/4 → soft-delete all → still at-cap | Seed an active Pro user. Generate 4 batches in the current 30-day period. Cancel + delete all four through the existing UI flow. Re-visit `/create`: the `monthly_cap_active` gated screen MUST still render. `subscriptionService.checkSubscription` MUST return `proQuota.used === 4`. |
| Trial used → soft-delete → still gated | Trial user generates their lifetime-1 batch, cancels, deletes. `/create` MUST still surface `trial_batch_exists`. `canGenerate` MUST still return `allowed: false`. |
| Starter weekly → soft-delete → still blocked | Starter user generates a batch on day 0, cancels and deletes on day 3. `/create` MUST surface `weekly_cap_active` with `nextResetAt = createdAt + 7d` — same date the original batch would have produced. |
| Soft-deleted batch invisible in lists | After delete, the batch MUST NOT appear on `/create`'s unscheduled list, `/schedule`'s 2×2 grid, `/posts`'s resume fallback, or as a direct hit on `/schedule/[batchId]` (deep link returns 404 / blank). |
| Images still preserved | The batch's images MUST appear in `/library` after delete. (`imageService.retainImagesToLibrary` contract.) |
| Child rows cleaned | After delete, `posts`, `post_images`, `post_variations`, `post_selections`, and `scheduled_posts` rows for that `batchId` MUST be gone. Only the `weekly_batches` tombstone remains. |
| Quality gates | `pnpm lint && pnpm typecheck && pnpm test && pnpm build:ci` all clean. |
| Pre-fix tombstones (none) | Confirm no existing rows have `deleted_at` set after migration. |
