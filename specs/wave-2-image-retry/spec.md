# Image Retry & Regenerate — Wave 2 spec

**Goal:** let a user fix or replace a single image on a generated batch without re-running the whole batch. Two distinct triggers share one cap (2 attempts total per `post_images` row):

| Trigger | Tile state | Tier gate | Outcome |
|---|---|---|---|
| **Retry** | `status='failed'` | All tiers (free_trial, starter, pro) | Try once more to produce *any* image |
| **Regenerate** | `status='success'` | Pro + active only | Try once more to produce a *different* image |

Both reuse the existing `weekly_batches.batchImageStyle` + the row's `imagePrompt`, so a retried or regenerated image stays in the same visual set as its siblings. No batch-wide regenerate. No third attempt.

---

## Out of scope — future waves

| Wave | What |
|---|---|
| **Wave 3** | User deletes the AI image and uploads their own. Blob lifecycle (delete after publish). |
| **Wave 4** | Cross-period retention / purge — keep current-period batches + 3 most recent from previous period. |
| **Later** | Prompt editing on retry. Style swap mid-batch. Per-image cost telemetry. Refund/credit logic. Multi-attempt history beyond `attempt`. Background reaper for stale `generating`/`regenerating` rows (Wave 1 already has this exposure; Wave 2 inherits it). |

---

## PDF alignment notes

Wave 1's spec already noted (per `specs/image-generation/spec.md` §PDF alignment) that Vision PDF §6 describes the *eventual* image flow as "AI generates → Accept / Regenerate (up to 3 on Pro) / Upload own / Skip", and that Wave 1 shipped only the first arm. **Wave 2 adds the Regenerate arm + a Retry escape hatch for failures.** Two conflicts to surface:

1. **Cap diverges from the PDF.** Vision PDF §6 says "up to 3 on Pro". This spec ships a **2-attempt cap** — initial + 1 retry/regenerate. Rationale: `post_images.attempt` was scoped to 2 in Wave 1's schema commit and the user explicitly confirmed the 2-cap during Wave 2 planning. The PDF's "3" is the long-term aspiration; this wave establishes the mechanism with the lower cap and the limit can be raised by changing one constant when payment infra lands.
2. **Retry on failure was not in the PDF as a Pro-gated feature.** Wave 1's spec already pre-committed retry as "all tiers" in its Out-of-scope table (§Out of scope row Wave 2). This spec keeps that — retry is universal, regenerate is Pro-only.

---

## Architectural decisions (one line each, with rationale)

1. **Two server actions, not one.** `retryImageAction` and `regenerateImageAction` live side-by-side. Reason: different tier gates, different status preconditions, different failure-recovery semantics (retry-fail goes to `failed`; regenerate-fail reverts to `success`). One action with a mode flag would smuggle two control flows behind one signature.
2. **New status value `'regenerating'`, not a separate boolean column.** Reason: the polling channel already carries `status`; adding a value extends an existing wire format instead of widening it. The UI needs to render *the original image, dimmed* during regenerate — distinct from `'generating'`, which renders a skeleton.
3. **Original `imageUrl` is preserved through the regenerate flow.** The conditional UPDATE does NOT clear `imageUrl` when flipping to `'regenerating'`. On regenerate failure, the service writes `status='success'` and leaves `imageUrl` untouched, so the original survives. The user never loses good content to a failed regenerate.
4. **Same single-row service runner for both flows.** `runImageGenerationForRow(postImageId, mode: 'retry' | 'regenerate')` in `image-service.ts`. Mirrors Wave 1's `runImageGenerationForBatch` but for one row. The `mode` parameter only changes the failure-path UPDATE; the success path is identical.
5. **Conditional UPDATE for concurrency safety.** Every status transition is `UPDATE ... WHERE id=? AND userId=? AND status=<expected> AND attempt=1`. Two simultaneous clicks: one wins, the other affects 0 rows and resolves to `already_in_progress`. No row-level locks, no advisory locks, no Redis — Postgres' MVCC + the WHERE clause suffices.
6. **Tier gate is server-authoritative; client hides as a courtesy.** `regenerateImageAction` calls `subscriptionService.checkSubscription(userId)` and rejects with `'pro_required'` if not `plan='pro' && status='active'`. The tile separately hides the regenerate icon for non-Pro users so the UI never even renders the affordance. Defense-in-depth: client hide + server reject.
7. **`after()` from `next/server` reuse.** Wave 1 verified `after()` works in this Next 16.1.6 + Turbopack setup (probe documented in `specs/image-generation/spec.md` §R3). Wave 2 reuses the same primitive — no new probe needed.
8. **Retries do NOT consume `canGenerate` quota.** Confirmed with user during planning. `canGenerate` gates batch *creation*; retries fix an image inside an already-counted batch. The two actions never call `canGenerate`.

---

## Schema changes

Single change: extend `post_images.status` union to include `'regenerating'`.

### `src/lib/schema.ts`

```ts
// Status union widened from 4 → 5 values
status: text("status").notNull().default("pending"),
// Union: "pending" | "generating" | "success" | "failed" | "regenerating"
```

The column is a plain `text` with no CHECK constraint in Wave 1 (see `src/lib/schema.ts:340-376`). Adding a new union value is a **type-only change** in the application code. The `drizzle generate` step may produce a no-op or a metadata-only migration — that is expected. Generate and apply it anyway for audit trail.

No other schema changes:
- `imageUrl` already nullable (Wave 1).
- `attempt` already exists with default 1 (Wave 1, never incremented yet).
- `batchImageStyle` already on `weekly_batches` (Wave 1).
- `imagePrompt` already stored per-row with the combined prompt (Wave 1).

### Migration ordering

Single migration generated by `drizzle generate`. Apply via `drizzle migrate`. NEVER `drizzle push`.

---

## Behaviour matrix (`status` × `attempt` × tier → render)

`a1` = first attempt (`attempt=1`), `a2` = second attempt used (`attempt=2`).

| status | attempt | Pro + active | Starter / free_trial / Pro-expired |
|---|---|---|---|
| `pending` / `generating` | a1 | Skeleton (`animate-pulse bg-muted`) | Skeleton |
| `regenerating` | a2 | Original `<img>` at `opacity-60` + centered `Loader2 animate-spin text-primary size-7` | (not reachable — Pro-only path) |
| `success` | a1 | Image + persistent corner `RefreshCw` icon button (regenerate affordance) | Image, no controls |
| `success` | a2 | Image, no controls | Image, no controls |
| `failed` | a1 | `ImageOff` placeholder + "Try again" button (`Button` variant `secondary`, size `sm`, `RefreshCw` icon) | Same — retry is universal |
| `failed` | a2 | `ImageOff` placeholder + static text "Couldn't generate this image." | Same |

Copy follows DESIGN.md §14 — no exclamation points, single-sentence empty state.

---

## Server action contracts

Both live in `src/app/(app)/(onboarded)/posts/actions.ts` (matches the Wave 1 server-action pattern confirmed in Stage 0 research).

### `retryImageAction(postImageId: string)`

```ts
type Result =
  | { ok: true }
  | { ok: false, reason: 'not_owned' | 'not_failed' | 'attempts_exhausted' | 'already_in_progress' }
```

Steps:
1. Resolve session userId (existing helper).
2. Conditional UPDATE:
   ```sql
   UPDATE post_images
   SET status='generating', attempt=2
   WHERE id=? AND userId=? AND status='failed' AND attempt=1
   ```
3. If 0 rows affected → re-read the row to map the failure mode:
   - row missing or `userId` mismatch → `not_owned`
   - `status !== 'failed'` → `not_failed`
   - `attempt >= 2` → `attempts_exhausted`
   - row is currently `generating` (raced click) → `already_in_progress`
4. Schedule `runImageGenerationForRow(postImageId, 'retry')` via `after()`.
5. Return `{ ok: true }`.

### `regenerateImageAction(postImageId: string)`

```ts
type Result =
  | { ok: true }
  | { ok: false, reason: 'not_owned' | 'not_successful' | 'attempts_exhausted' | 'already_in_progress' | 'pro_required' }
```

Steps:
1. Resolve session userId.
2. **Tier gate (before any DB write):** call `subscriptionService.checkSubscription(userId)`. If not `(plan === 'pro' && status === 'active')` → return `{ ok: false, reason: 'pro_required' }`.
3. Conditional UPDATE:
   ```sql
   UPDATE post_images
   SET status='regenerating', attempt=2
   WHERE id=? AND userId=? AND status='success' AND attempt=1
   ```
   `imageUrl` is **deliberately not cleared**.
4. If 0 rows affected → map the failure mode (`not_owned` / `not_successful` / `attempts_exhausted` / `already_in_progress`).
5. Schedule `runImageGenerationForRow(postImageId, 'regenerate')` via `after()`.
6. Return `{ ok: true }`.

---

## Service function

Add to `src/lib/services/image-service.ts` (already exists; new function alongside `runImageGenerationForBatch`).

```ts
async function runImageGenerationForRow(
  postImageId: string,
  mode: 'retry' | 'regenerate'
): Promise<void>
```

Steps:
1. SELECT the row with an inner join to `posts` + `weekly_batches` (to read `batchImageStyle`).
2. Combine the prompt: `batchImageStyle + ' ' + imagePrompt` — same recipe as Wave 1's batch path. (The row's `imagePrompt` already stores the *combined* string per Wave 1 §Schema, so this can be re-derived from `batchImageStyle` + the per-post subject if needed, OR just re-sent verbatim. Implementation choice: re-send verbatim — what's stored is what was sent originally; re-deriving is unnecessary complexity.)
3. Call `generateImage({ combinedPrompt })` — Wave 1 contract: never throws, returns `null` on any failure.
4. Outcome dispatch by `mode`:

| mode | OpenAI + Blob success | OpenAI or Blob failure |
|---|---|---|
| `retry` | `UPDATE SET status='success', imageUrl=<new>` | `UPDATE SET status='failed'` (attempt already at 2 → exhausted) |
| `regenerate` | `UPDATE SET status='success', imageUrl=<new>` (overwrites original) | `UPDATE SET status='success'` (imageUrl unchanged → original preserved) |

All errors caught and logged; never bubble. Matches Wave 1's never-throws convention (`src/lib/services/image-service.ts` Wave 1 contract).

**No concurrency limit needed.** Single row, single user click — `pLimit` is unnecessary here. (`runImageGenerationForBatch` uses `pLimit(3)` because it fans out N parallel calls; single-row work doesn't.)

---

## Polling shape change

Extend the `PostImageStatus` type and `getBatchImageStatusesAction` return shape to include `attempt`.

```ts
type PostImageStatus = {
  status: 'pending' | 'generating' | 'success' | 'failed' | 'regenerating';
  imageUrl: string | null;
  attempt: number;  // NEW
}
```

In `src/components/posts/network-wizard.tsx`:
- `anyPending(images)` is extended to count `'regenerating'` as pending. Polling continues while any tile is in `pending`, `generating`, or `regenerating`. Stops when every row is `success` or `failed` (no `attempt` check — the `attempt` field is for UI rendering, not for polling-lifecycle).
- Polling cadence (`IMAGE_POLL_INTERVAL_MS = 2500`) is unchanged.

---

## UI changes

### `src/components/posts/post-tile-image.tsx`

Add props:
- `isPro: boolean` — resolved server-side once at page render, threaded down via `network-wizard.tsx`.
- `onRetry: (postImageId: string) => void` — wired by parent.
- `onRegenerate: (postImageId: string) => void` — wired by parent.

Render branches per the §Behaviour matrix above. New visual elements:

| Element | Style |
|---|---|
| Retry button (failed, a1) | `<Button variant="secondary" size="sm">` with `RefreshCw` icon (stroke 1.5, `size-4`). Label "Try again". Centered under the `ImageOff` icon. |
| Exhausted message (failed, a2) | `<p className="text-sm text-muted-foreground">Couldn't generate this image.</p>`. No control. |
| Regenerate icon (success, a1, isPro) | `<Button variant="ghost" size="icon">` positioned `absolute top-3 right-3`. Contains only `<RefreshCw className="size-4" />`. Resting `opacity-70`; hover `opacity-100`. Accessible name "Regenerate image". |
| Regenerating overlay (regenerating) | `<img>` rendered at `opacity-60`. Above it, `<Loader2 className="animate-spin text-primary size-7" />` absolutely centered. |

### `src/components/posts/network-wizard.tsx`

1. Server-side at page render: resolve `isPro = (subscription.plan === 'pro' && subscription.status === 'active')` once and thread it down to each tile.
2. Click handlers:
   - **Retry click:** Optimistically flip the local `image.status` to `'generating'` (same skeleton as initial gen). Fire `retryImageAction`. On `{ok:false}`: revert and toast the reason mapped to user-friendly copy.
   - **Regenerate click:** Optimistically flip local `image.status` to `'regenerating'` — `imageUrl` stays as-is, tile renders the dimmed overlay. Fire `regenerateImageAction`. On `{ok:false}`: revert and toast the reason.
3. **"Kept original" toast detection:** track each tile's `(status, imageUrl)` across poll ticks. When a tile transitions `'regenerating' → 'success'` AND `imageUrl` is unchanged from the snapshot taken just before regenerate kicked off → fire toast: *"Regeneration failed. Kept the original image."* The toast uses the existing Sonner error-style (per DESIGN §9), `AlertCircle` icon, 4s default duration.
4. If a tile transitions `'regenerating' → 'success'` AND `imageUrl` changed → no toast. The new image swap is itself the success signal.

### Reason-code → toast copy mapping (v1 — minimal)

| Reason | Toast |
|---|---|
| `not_owned` | "You don't have access to this image." (error) |
| `not_failed` / `not_successful` | "This image was already updated. Refresh to see the latest." (error) |
| `attempts_exhausted` | "No more attempts left for this image." (error) |
| `already_in_progress` | "Already retrying — give it a moment." (info) |
| `pro_required` | "Regenerating an image is a Pro feature." (info) |

Copy follows DESIGN §14 — no exclamation points, plain confident voice.

---

## Concurrency, edge cases, things to watch

| # | Case | Behaviour |
|---|---|---|
| 1 | Double-click on retry/regenerate | Conditional UPDATE → second click affects 0 rows → action returns `already_in_progress`. Button is also locally disabled while the request is in flight. |
| 2 | Tab close mid-flight | Row stays `generating` or `regenerating`. On next page load polling sees the pending state and resumes. (Same exposure as Wave 1; not solved here.) |
| 3 | Subscription downgrade between original gen and regenerate click | Pro at gen → row has `attempt=1`. If user downgrades to Starter, the tile's `isPro` flips false → corner icon disappears. If a click somehow races the downgrade, the server `pro_required` gate rejects. No refund mechanism (no credit was charged). |
| 4 | Pro subscription `status='expired'` | Treated as not-Pro for regenerate gate. Retry still works. |
| 5 | OpenAI / Blob failure during regenerate | Caught at service layer, row reverts to `status='success'`, `imageUrl` unchanged. Client toast fires per the §UI changes §3 detection. |
| 6 | OpenAI / Blob failure during retry | Caught at service layer, row UPDATE to `status='failed'`. attempt=2 → tile shows exhausted message on next poll. |
| 7 | Stale `generating`/`regenerating` row (crash) | Not solved in Wave 2. Documented exposure inherited from Wave 1. Future: background reaper job. |
| 8 | User on free_trial with a failed image | Retry button shows. Generation runs. No tier gate on retry. |

---

## Stage breakdown (sequential — each stage is one commit)

| Stage | Scope | Risk |
|---|---|---|
| **Stage 1 — schema + backend** | Add `'regenerating'` to status union in `schema.ts`; drizzle generate + migrate; add `runImageGenerationForRow` to `image-service.ts`; add `retryImageAction` + `regenerateImageAction` to `posts/actions.ts` with conditional UPDATEs and (regenerate only) Pro tier gate. | Migration likely metadata-only — verify. Server-only file boundary must hold. |
| **Stage 2 — polling shape** | Extend `PostImageStatus` with `attempt: number`. Update `getBatchImageStatusesAction` SELECT. Update `anyPending` in `network-wizard.tsx` to include `'regenerating'`. | Must precede Stage 3/4 (which read `attempt`). |
| **Stage 3 — UI: retry on failed tiles** | Add retry button + exhausted message to `post-tile-image.tsx`. Wire to `retryImageAction` from `network-wizard.tsx` with optimistic flip-to-skeleton. Toast on `{ok:false}`. | Lowest-risk UI change; ships value to all tiers. |
| **Stage 4 — UI: regenerate for Pro** | Thread `isPro` server-side → tiles. Add corner regenerate icon (Pro only, success+a1). Add `'regenerating'` rendering (dimmed image + spinner). Wire to `regenerateImageAction` with optimistic state. Detect `regenerating → success` with unchanged URL → "kept original" toast. | Largest surface area; isolated to the success+Pro path. |

Each stage leaves the app in a working state. After Stage 1+2 alone, the polling channel knows about `attempt` but the UI doesn't use it yet — that's fine. After Stage 3, retry works end-to-end. Stage 4 lands the regenerate path on top.

---

## Wave 2 acceptance criteria

A Wave 2 ship is complete if **all** of the following hold:

1. **Migration applied cleanly.** `drizzle generate` + `drizzle migrate` run without error. `npm run lint`, `npm run typecheck`, `npm run build` all pass.
2. **Failed tile, free_trial user:** clicking "Try again" flips the tile to skeleton, polls, lands as either `success` (image renders) or `failed` (exhausted message). No exception bubbles.
3. **Failed tile, starter user:** same behaviour.
4. **Failed tile, Pro user, a2 failure:** ends with the static "Couldn't generate this image." message and no further control.
5. **Successful tile, Pro user, regenerate succeeds:** clicking the corner icon → tile dims + spinner → new image lands → corner icon is gone (attempt=2).
6. **Successful tile, Pro user, regenerate fails:** original image is still visible. Toast appears: "Regeneration failed. Kept the original image." Corner icon is gone (attempt=2).
7. **Successful tile, Starter user:** no corner icon visible. Tile is just an image.
8. **Successful tile, free_trial user:** no corner icon visible.
9. **Pro expired:** treated as Starter for regenerate. Retry on failed tiles still works.
10. **Concurrency:** clicking retry twice in rapid succession — only one OpenAI call fires. Verified by adding a temporary log + spamming the button.
11. **Tab close mid-flight:** reload returns to a tile in `generating`/`regenerating` and polling resumes; final state is consistent.
12. **No regressions in Wave 1 happy path** — initial batch generation still works exactly as before. Polling still terminates on the all-terminal condition.

---

## Risks & open questions

| # | Risk / question | Notes |
|---|---|---|
| R1 | "Already in progress" race window between optimistic UI flip and server response | Local button disable while pending mitigates. If a user reloads mid-flight, the polling re-discovers state. Acceptable. |
| R2 | What if a regenerate succeeds but produces a *visibly similar* image to the original? | Out of scope for Wave 2. The OpenAI image API is stochastic; the spec doesn't promise "different", only "another attempt". |
| R3 | Stale `regenerating` row if `after()` job dies | Inherited from Wave 1. Same `pending`/`generating` exposure. Background reaper is a future wave. |
| R4 | Toast spam on multi-tile failures (e.g., user regenerates two tiles, both fail) | Two toasts will fire. Acceptable in v1. Sonner stacks them. |
| R5 | iOS Safari hover-discovery edge cases | The corner icon is persistent (not hover-revealed) specifically to avoid this — confirm with the user the click target is ≥ 44px (DESIGN §12). `Button size="icon"` is `size-11` (44px) which satisfies. |
| R6 | Translation/localisation of toast copy | No i18n in the project yet. Copy stays inline. |

---

## File-level change summary (for the implementer)

| File | Change |
|---|---|
| `src/lib/schema.ts` | Extend `post_images.status` union to include `'regenerating'`. |
| `drizzle/...` (new migration) | Generated by `drizzle generate`. Apply via `drizzle migrate`. May be a metadata-only / no-op migration — that's fine. |
| `src/lib/services/image-service.ts` | Add `runImageGenerationForRow(postImageId, mode)`. Reuses `generateImage`, `upload`, ownership-via-userId pattern. |
| `src/app/(app)/(onboarded)/posts/actions.ts` | Add `retryImageAction` and `regenerateImageAction`. Both: session check → conditional UPDATE → `after()` schedule → return result. Regenerate also: tier gate via `subscriptionService.checkSubscription`. |
| `src/components/posts/post-tile-image.tsx` | Add `isPro`, `onRetry`, `onRegenerate` props. Add retry button (failed+a1), exhausted message (failed+a2), corner regenerate icon (success+a1+isPro), regenerating overlay (regenerating). |
| `src/components/posts/network-wizard.tsx` | Resolve `isPro` server-side, thread to tiles. Wire `onRetry`/`onRegenerate` with optimistic local state. Extend `anyPending` to include `'regenerating'`. Detect `regenerating → success` with unchanged `imageUrl` → "kept original" toast. Update `PostImageStatus` type. |

No changes to: `subscription-service.ts` (read-only consumer), `post-service.ts`, `post-generator.ts`, `image-generator.ts`, `openai.ts`, storage.ts.

---

## Stage task files

Each stage has a self-contained brief alongside this spec:

- `stage-1-schema-backend.md`
- `stage-2-polling-shape.md`
- `stage-3-ui-retry-failed.md`
- `stage-4-ui-regenerate-pro.md`

Implementers should read `spec.md` for context, then work from the stage file. Stages are sequential — do not start Stage N+1 until Stage N is committed and the build is green.
