# Image Library (foundation) — Wave 3 spec

**Goal:** ship the image library as a real product surface — capped at 100, with lock semantics, monthly self-service cleanup, and the hooks for "image was posted to social media → delete it" and a future per-post picker. The library has two long-term roles:

1. **Safety net** — collects images from deleted/unused posts so users don't lose work.
2. **Browse-and-swap tool** — future picker reuses library images on new posts.

Wave 3 ships #1 in full and leaves the structural seams for #2 (no picker UI in this wave).

---

## Out of scope — future waves

| Wave | What |
|---|---|
| **Wave 4** | Per-post library picker UI ("swap from library" on a tile). Wave 3 leaves `source='library'`, the `lastUsedAt` column, and a `pickFromLibrary(libraryImageId, postImageId)` service stub for this. |
| **Wave 5+** | User upload from device (the `source='uploaded'` path). Schema already supports it; UI doesn't. |
| **Later** | Re-enabling the cleanup reminder once dismissed (Settings toggle), undo/restore window after auto-cleanup, admin/Operator dashboards. |

---

## PDF alignment notes (per memory rule — surface conflicts with prior decisions)

Loaded `UniqueMe_App_Vision_and_Architecture.pdf` before drafting. Other 8 PDFs are not relevant to library mechanics.

1. **No conflict.** Vision PDF §1, §6, §9 says nothing about an image library, monthly cleanup, locks, or a 100-cap. Wave 3's locked decisions are net-new product scope, not corrections to the PDF.
2. **PDF §6** describes the image-generation flow as ending in "AI generates → Accept / Regenerate / Upload own / Skip". UniqueMe shipped a single-image-per-post model in Wave 1 and added retry + regenerate in Wave 2. The library extends this with "library + upload" as future sources for post images — directionally aligned with the PDF.
3. **PDF §9 database tables** doesn't list `library_images`. The table was added in Phase 2 Stage 2 (D-S2-4) for the cancelled-batch retain flow. Existing extension, not a conflict.

---

## Architectural decisions (one line each, with rationale)

1. **Lock on `library_images` only, not on `post_images`.** Reason: the padlock gesture is a library-tile interaction; while an image is on an in-flight post, it's already protected by the post relationship (cleanup excludes "used" images). Single source of truth, no cross-table sync.
2. **Cap is enforced ONLY by monthly cleanup, not by silent eviction on insert.** Reason: matches the user's stated mental model ("cleanup runs ONLY when the user opens the app for the first time in a new month"). `retainImagesToLibrary` loses its current 30-cap eviction logic — between cleanups, the library can swell past 100. Next first-of-month visit catches it up.
3. **"New month" = calendar month in the user's browser TZ.** Resolved client-side as `YYYY-MM` string and submitted with the visit-detection action. Server stores `profiles.lastCleanupCheckMonth = "YYYY-MM"` and compares string equality. Avoids server-side TZ gymnastics; the user's experience matches their wall clock.
4. **Posted-image deletion fires only when ALL platforms posted.** Reason: matches user's locked decision. Implementation: a `deleteImageIfAllPlatformsPosted(postId)` helper checks whether every `scheduledPosts` row for the post has `status='posted'`. Wave 3 ships the helper; the future posting cron will call it after each `scheduledPosts.status` transition to `'posted'`.
5. **`post_images.publishedAt` is the "posted" flag.** Already in schema, never written. Wave 3 starts writing it (non-NULL = published). No new boolean needed.
6. **Source column kept as `"ai" | "uploaded" | "library"` (existing union).** User said "upload" (singular) in the brief; existing code says "uploaded" (past tense). Confirmed: keep existing to avoid a column migration.
7. **ZIP download via streaming route handler + `archiver` dep.** Reason: chosen format. Server fetches each Blob URL, pipes into the archiver, streams the ZIP to the client. One file, one progress bar. No temp-blob upload, no client-side download orchestration.
8. **Monthly cleanup is gated on a server action, not a hook fired automatically.** Reason: deterministic, testable, observable. The first onboarded layout render of a session calls `checkMonthlyCleanupAction(currentYyyyMm)`. The server decides "show modal", "run silently", or "nothing to do" and returns instructions for the client.
9. **`lastUsedAt` ships in Wave 3 but is only WRITTEN by the future picker.** Wave 3 reads it in the cleanup sort order (`COALESCE(lastUsedAt, createdAt) ASC`) so when the picker ships, recently-used images naturally survive cleanup.
10. **Padlock affordance: solid pill = locked, ghost = unlocked.** Reason: lucide's `Lock` / `Unlock` icons are stroke-based outlines, so "filled vs outline" comes from a background pill (locked = primary-tinted pill, unlocked = transparent ghost). Reads unambiguously as "protected from deletion".

---

## Schema changes

All via `drizzle generate` + `drizzle migrate`. Never push.

### `library_images` — add two columns

```ts
// In the libraryImages pgTable definition
lockedAt: timestamp("locked_at"),        // nullable — null = unlocked
lastUsedAt: timestamp("last_used_at"),   // nullable — null = never reused since insert
```

`lockedAt` doubles as the lock indicator (non-null = locked) and an audit timestamp (when the user locked it). Cleaner than a boolean + separate timestamp.

### `profiles` — add two columns

```ts
// Track first-visit-of-month detection.
// Format: "YYYY-MM" (the user's local TZ). Compared as string equality
// against the client-supplied current month. NULL on legacy rows reads
// as "never checked" → check fires on first visit.
lastCleanupCheckMonth: text("last_cleanup_check_month"),

// User dismissed the lock-reminder modal with "Don't show again".
// Once true, monthly cleanup runs silently. No Settings toggle to
// re-enable in Wave 3 — future work.
monthlyCleanupReminderDismissed: boolean("monthly_cleanup_reminder_dismissed").notNull().default(false),
```

### `post_images` — no DDL change

- `publishedAt` is already nullable timestamp. Wave 3 starts writing it.
- `source` union stays `"ai" | "uploaded" | "library"`.

### `LIBRARY_CAP` constant

`src/lib/services/image-service.ts:43` → change from `30` to `100`.

### Migration ordering

Single migration generated by `drizzle generate`. Three `ALTER TABLE` statements (library_images + profiles, no DDL needed for post_images). No data backfill — all new columns are nullable / have defaults.

---

## Service layer (`imageService` extensions)

All in `src/lib/services/image-service.ts`. Result-style returns matching existing pattern.

### `runMonthlyCleanup(sessionUserId, currentMonthYyyyMm): Promise<CleanupResult>`

```ts
type CleanupResult =
  | { ok: true; action: "none" | "ran"; deleted: number; over: number }
  | { ok: false; error: "unauthenticated" }
```

Steps:
1. Read `profile.lastCleanupCheckMonth`. If equal to `currentMonthYyyyMm`, return `{ ok: true, action: "none", deleted: 0, over: 0 }`. (Already checked this month.)
2. Count `library_images` for the user.
3. If count ≤ 100, update `lastCleanupCheckMonth = currentMonthYyyyMm` and return `{ ok: true, action: "none", deleted: 0, over: 0 }`. (Under cap; nothing to do.)
4. Compute `over = count - 100`.
5. SELECT up to `over` rows where `lockedAt IS NULL` AND the image is not "in use" (see "Unused definition" below). Sort by `COALESCE(lastUsedAt, createdAt) ASC` (oldest first).
6. For each row: `safeDeleteBlob(row.imageUrl)`, then DELETE the row.
7. Update `lastCleanupCheckMonth = currentMonthYyyyMm`.
8. Return `{ ok: true, action: "ran", deleted: <count>, over: <original overage> }`.

If fewer than `over` deletable rows exist (lots of locked or in-use images), delete what we can and return the actual count. Library shows `count/100` and the user can manually unlock.

### `toggleLibraryImageLock(sessionUserId, libraryImageId, lock: boolean): Promise<ImageServiceResult>`

Conditional UPDATE: `SET locked_at = (lock ? now() : null) WHERE id = ? AND user_id = ?`. Returns `not_found` if 0 rows matched.

### `deleteAllLibraryImages(sessionUserId, mode: "unlocked-only" | "all"): Promise<{ ok: true; deleted: number }>`

Bulk delete:
- `"unlocked-only"`: SELECT WHERE userId=? AND lockedAt IS NULL → `safeDeleteBlob` each → DELETE
- `"all"`: SELECT WHERE userId=? → same → ignores lock state

Both: blob deletes happen AFTER reading the URLs but BEFORE the DB delete (matches existing `deleteLibraryImage` ordering).

### `deleteImageIfAllPlatformsPosted(postId: string): Promise<void>`

Called by the **future** posting service after each `scheduledPosts.status` transition to `"posted"`. Wave 3 ships the function; nothing in the current code calls it.

Steps:
1. SELECT all `scheduledPosts` for `postId`.
2. If ANY row has `status !== "posted"`, return (still waiting on a platform).
3. SELECT the `post_images` row for `postId` (`imageUrl`, `source`, `publishedAt`).
4. If `imageUrl` is NULL or `publishedAt` is already non-null → return (defensive; already handled).
5. Dispatch by `source`:
   - `"ai"` or `"uploaded"`: `safeDeleteBlob(imageUrl)` (this post's blob is its own)
   - `"library"`: do NOT delete blob (library_images still owns it) — only clear the post_images pointer
6. UPDATE `post_images SET imageUrl = NULL, publishedAt = now() WHERE postId = ?`.

Never throws. Best-effort blob delete via `safeDeleteBlob` (already logs orphans to `post_logs`).

### `pickFromLibrary(libraryImageId, postImageId, sessionUserId): Promise<ImageServiceResult>` — STUB

Implementation deferred to Wave 4 (the picker UI). Wave 3 exports a stub that returns `{ ok: false, error: "not_implemented" }` so the future picker has a stable import surface. Listed here so the spec is honest about what's wired vs what's a placeholder.

### `retainImagesToLibrary` — behavior change

Remove the LIBRARY_CAP eviction logic. The function still:
- Gates on ownership (`not_owned` if any row belongs to another user)
- Holds the `pg_advisory_xact_lock(hashtext('library:' || userId))` (race protection)
- Filters NULL `imageUrl` rows (only retain successes)
- Inserts the rows

But it no longer evicts. Cap enforcement moves entirely to `runMonthlyCleanup`.

---

## Server actions

`src/app/(app)/(onboarded)/library/actions.ts` (extend the existing file).

| Action | Calls |
|---|---|
| `checkMonthlyCleanupAction(currentMonthYyyyMm: string)` | Reads `profile.monthlyCleanupReminderDismissed` and `library_images` count. Returns `{ cleanupNeeded: boolean, shouldShowReminder: boolean, over: number, count: number }`. Does NOT mutate `lastCleanupCheckMonth` — that's `runMonthlyCleanupAction`'s job. |
| `runMonthlyCleanupAction(currentMonthYyyyMm: string)` | Calls `imageService.runMonthlyCleanup`. Revalidates `/library`. |
| `dismissCleanupReminderAction()` | UPDATE `profiles.monthlyCleanupReminderDismissed = true`. |
| `toggleLibraryImageLockAction(libraryImageId, lock: boolean)` | `imageService.toggleLibraryImageLock`. Revalidates `/library`. |
| `deleteAllLibraryImagesAction(mode: "unlocked-only" \| "all")` | `imageService.deleteAllLibraryImages`. Revalidates `/library`. |
| `getLibraryDownloadUrlAction()` | Returns `/api/library/download`. Action exists so the button click flows through the standard server-action import surface, even though the actual download is a GET. |

Existing `deleteLibraryImageAction` (single-tile) stays as-is.

---

## ZIP download (route handler)

**New file:** `src/app/api/library/download/route.ts`

GET handler. Steps:
1. Resolve session. 401 if missing.
2. Call `imageService.listLibrary(userId)`.
3. If empty, 204 No Content.
4. Create a streaming `Response`. Pipe each Blob URL's content into an `archiver` (zip) stream.
5. Set headers: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="uniqueme-library-${YYYY-MM-DD}.zip"`.

Filename per image inside the ZIP: `image-${index+1}.${ext}` derived from the blob URL extension (default `.png`). No PII in filenames — keeps it simple.

**Dep:** `archiver` (npm). Server-only, streaming. No `archiver-zip-encrypted` or other extensions needed.

**Concurrency:** the GET fetches all library URLs in parallel (`Promise.allSettled`). At 100 images × ~2MB average = ~200MB transfer. Acceptable for a manual export; if it bites, future work can chunk or move to the temp-Blob pattern.

---

## UI changes

### `/library` page (`src/app/(app)/(onboarded)/library/page.tsx` + grid)

Page header now shows:
- Title: "Your image library"
- Count pill: `{count}/100 images` (was `/30`)
- Two new buttons (right-aligned):
  - **Download all** (`secondary` variant) — `Download` icon
  - **Delete all** (`outline` variant) — `Trash2` icon

Tile changes:
- New persistent corner **padlock icon** (top-left). Two visual states:
  - **Locked** (`lockedAt` is non-null): `Lock` icon (lucide) inside a solid `bg-primary/15 border border-primary/30 rounded-md` pill, `text-primary`. Reads as "protected".
  - **Unlocked** (`lockedAt IS NULL`): `Unlock` icon (lucide), no background pill, `text-muted-foreground/70`. Reads as "removable".
  - Clicking toggles `toggleLibraryImageLockAction`. Optimistic UI.
- Existing hover-revealed delete overlay (Trash2 + "Delete") stays as-is — same dialog.
- Small bottom-left timestamp badge showing relative `COALESCE(lastUsedAt, createdAt)` ("Added 3d ago" / "Used 1w ago"). Subtle; no chip background.

### Cleanup reminder modal (new component)

`src/components/library/cleanup-reminder-dialog.tsx`. Shadcn Dialog.

Surfaced by the onboarded layout reading the result of `checkMonthlyCleanupAction`. If `cleanupNeeded === true` and `shouldShowReminder === true`, the layout mounts the modal.

Modal content:
- Title: "Your image library is full"
- Body: "You have {count} images saved, over the 100-image limit. We'll keep the ones you've locked 🔒 and remove the oldest unlocked images to make room."
- Tip: "Lock any images you want to keep before continuing."
- Checkbox: "Don't show this reminder again"
- Buttons: `Cancel` (secondary) and `Proceed` (primary)

On `Cancel`: close modal, DO NOT call cleanup, DO NOT update `lastCleanupCheckMonth`. Re-shows on next page-load.

On `Proceed`:
- If checkbox ticked, call `dismissCleanupReminderAction()`.
- Call `runMonthlyCleanupAction(currentYyyyMm)`.
- Toast: "Removed {n} unlocked images."
- Revalidate `/library`.

If `monthlyCleanupReminderDismissed === true` AND `cleanupNeeded === true`, the layout calls `runMonthlyCleanupAction(currentYyyyMm)` directly without a modal. Silent cleanup. The library page surfaces a small inline note "Cleaned up {n} images this month" on next `/library` visit.

### Download-all flow + popup

Click handler on Download all:
1. Trigger the download by navigating to `/api/library/download` (anchor with `download` attribute is cleanest — preserves user gesture).
2. Open a new dialog (`download-cleanup-prompt-dialog.tsx`): "Your download is starting. Now that you have copies, do you want to clear the library?"
3. Two buttons + X:
   - **Delete all images (incl. locked)** → calls `deleteAllLibraryImagesAction("all")`
   - **Delete only unlocked** → calls `deleteAllLibraryImagesAction("unlocked-only")`
   - **X (top-right)** → close, no delete

Per the user's locked decision exactly.

### Delete all flow

Click "Delete all" button → confirmation dialog (`delete-all-confirmation-dialog.tsx`) → call `deleteAllLibraryImagesAction("unlocked-only")` (respects locks per locked decision).

---

## "Unused" definition for cleanup

An image is **unused** if it is NOT referenced by any `post_images` row whose parent post's batch is in one of these states:
- `reviewing` (active wizard)
- `scheduling` (committing)
- `scheduled` (queued to post)
- `cancelled` (recoverable, partial Item 6)

It IS "unused" (and eligible for cleanup) if its only `post_images` references are in batches with state:
- `completed` (posted and done)
- `in_progress` (stale/unreachable)
- No batch reference at all (the audit `originPostId` no longer survives)

Concretely: a `library_images` row's `originPostId` (audit-only, no FK) is checked against current `posts` rows. If the post still exists and its batch is active → "used", skip. If no surviving post OR the surviving post's batch is `completed` → eligible.

This is conservative: if you've imported an image into the library and then started using it on a new post, the picker (Wave 4) will set `lastUsedAt` AND attach to a `post_images` row. Until the post's batch goes `completed`, cleanup will protect it.

---

## Concurrency, edge cases, things to watch

| # | Case | Behaviour |
|---|---|---|
| 1 | User opens app from two devices on the 1st of the month | Both sessions call `checkMonthlyCleanupAction`. First calls `runMonthlyCleanupAction`, second reads `lastCleanupCheckMonth` as equal → returns `{action: "none"}`. No double cleanup. |
| 2 | Cleanup runs but all over-cap rows are locked | `runMonthlyCleanup` deletes 0 rows. Returns `{action: "ran", deleted: 0, over: N}`. Updates `lastCleanupCheckMonth`. Library shows `count/100` and user can manually unlock. |
| 3 | User clicks "Delete all (incl. locked)" then locks more | Confirmation dialog covers this — explicit user choice. |
| 4 | `retainImagesToLibrary` runs while user is at 99 → pushes them to 105 | Allowed. Cleanup at next month boundary handles it. Library page accepts >100 display gracefully. |
| 5 | Posting service publishes a post but `scheduledPosts` rows aren't all `posted` yet | `deleteImageIfAllPlatformsPosted` returns silently. The eventual final `posted` transition triggers cleanup. |
| 6 | Posting service crashes mid-way; one scheduled post stuck in `pending` indefinitely | Image stays attached to post. No cleanup. Inherited exposure from posting service — out of scope here. |
| 7 | TZ change (user travels) — `currentYyyyMm` flips a day late | Acceptable. Worst case: cleanup deferred to first visit after the actual UTC month change. |
| 8 | User dismissed cleanup reminder, can't re-enable | Documented. Future Settings work. |
| 9 | ZIP download hits Vercel function timeout (10s on Hobby, 60s on Pro) | At ~200MB the streaming should finish well inside 60s on Pro for a single user. If it bites, fallback is the "prepare server-side → temp link" pattern. |
| 10 | User triggers download-all twice quickly | Two GETs to `/api/library/download` — server-side concurrent fetches per request. Bandwidth-bound but functionally OK. |
| 11 | Lock toggle race: user double-clicks the padlock | Conditional UPDATE is atomic; second click sees the desired state already set. No-op. |

---

## Stage breakdown (sequential — one commit per stage)

| Stage | Scope | Risk |
|---|---|---|
| **Stage 1 — schema + cap raise** | Add `lockedAt`, `lastUsedAt` to library_images. Add `lastCleanupCheckMonth`, `monthlyCleanupReminderDismissed` to profiles. Bump `LIBRARY_CAP` to 100. Remove eviction logic from `retainImagesToLibrary`. drizzle generate + migrate. | Low. Schema additions are all nullable / default. Removing eviction means concurrent retains can briefly exceed 100 (intended — cleanup handles it). |
| **Stage 2 — service layer + actions** | `runMonthlyCleanup`, `toggleLibraryImageLock`, `deleteAllLibraryImages`, `deleteImageIfAllPlatformsPosted`, `pickFromLibrary` stub. Server actions wrapping each. | Medium. The "unused" SQL query touches multiple tables; needs care. Posted-image deletion is a contract for future code — no caller in this stage. |
| **Stage 3 — ZIP download endpoint** | Add `archiver` dep. Route handler at `/api/library/download`. `getLibraryDownloadUrlAction`. | Low. Standalone, testable via `curl`. |
| **Stage 4 — UI** | Library page header buttons. Padlock affordance on tiles. Last-used badge. Cleanup reminder dialog + onboarded-layout integration. Delete-all confirmation. Download-all popup. | Highest. Most surface area but isolated to `library/` directory. |

Each stage leaves the app in a working state. After Stage 1+2 the backend handles all the new mechanics but the UI doesn't surface them yet. After Stage 4, the user-visible feature is complete.

---

## Wave 3 acceptance criteria

A Wave 3 ship is complete if all of the following hold:

1. **Migration applies cleanly.** `drizzle generate` + `drizzle migrate` succeed. `lint`, `typecheck`, `build` all pass.
2. **Lock toggle.** Clicking the padlock on a library tile flips its visual state (solid pill ↔ ghost outline). DB row's `lockedAt` flips. Refresh preserves state.
3. **Delete all unlocked.** Confirm dialog → deletes only `lockedAt IS NULL` rows. Locked rows survive.
4. **Download all.** Triggers a ZIP download containing every image (lock state irrelevant). Popup appears with the two delete options + X.
5. **First visit of new month, over cap, never dismissed.** Modal shows. Proceed → cleanup runs, oldest unlocked + unused are deleted, `count` drops to ≤100. `lastCleanupCheckMonth` is updated.
6. **First visit, over cap, previously dismissed.** No modal. Cleanup runs silently. Library page shows "Cleaned up {n} images" inline note.
7. **First visit, under cap.** No modal, no cleanup. `lastCleanupCheckMonth` updated.
8. **Second visit same month, over cap.** No modal. No cleanup. (Already checked.)
9. **`deleteImageIfAllPlatformsPosted` contract.** Stub a test: insert a post with `scheduledPosts` rows. Set all to `posted`. Call the function. Verify `post_images.imageUrl` is NULL and `publishedAt` is set. With `source='library'`, the library_images row survives. With `source='ai'`, the blob is deleted.
10. **Cap raise.** Library can hold 100 rows without auto-eviction during a retain.
11. **No regressions.** Wave 1 image generation still works. Wave 2 retry/regenerate still works. `/library` page still loads and lists images.

---

## Locked-in assumptions

1. **"Unused"** = not referenced by `post_images` whose batch is in `reviewing`/`scheduling`/`scheduled`/`cancelled`. Conservative; protects in-flight work.
2. **`monthlyCleanupReminderDismissed` and `lastCleanupCheckMonth` live on `profiles`.** Existing per-user preferences home. No new table.
3. **Cleanup reminder surfaces on the first onboarded layout render after a new month.** Centralized check, not per-page.
4. **Last-used badge uses `COALESCE(lastUsedAt, createdAt)`.** Wave 3 never writes `lastUsedAt` (picker is Wave 4); the badge just shows "Added Xd ago" until then.
5. **TZ handled client-side.** Browser computes `YYYY-MM` and submits with the check action. Server only does string equality.
6. **Source naming.** Existing `"uploaded"` (past tense) is kept. No migration.
7. **Padlock icon set.** lucide-react's `Lock` (closed shackle) for locked, `Unlock` (open shackle) for unlocked. Locked = `bg-primary/15 border border-primary/30 text-primary` pill. Unlocked = `text-muted-foreground/70` ghost.
8. **One-way dismiss.** Wave 3 doesn't ship a Settings toggle to re-enable the reminder. Future work.
9. **No undo window after auto-cleanup.** Blobs are deleted immediately. Future enhancement: 24-hour soft-delete.
10. **`pickFromLibrary` is a stub.** Returns `{ ok: false, error: "not_implemented" }`. Wave 4 implements; this gives the picker a stable import surface to land against.

---

## Risks

| # | Risk | Notes |
|---|---|---|
| R1 | The "unused" query joins library_images → posts via audit-only `originPostId`. If a post id ever collided with a later post (impossible with UUIDs, but conceptually) the check would be wrong. | UUID collision is astronomically rare. Acceptable. |
| R2 | `archiver` streaming on Vercel: cold start + first-byte latency. | Should be fine for ≤100 images. Monitor; fallback is the "prepare server-side then link" pattern. |
| R3 | Posted-image deletion fires only when ALL platforms posted, but the posting service doesn't exist yet. Contract may evolve when it's built. | Documented. The function signature is small and easy to revise. |
| R4 | Removing eviction from `retainImagesToLibrary` means current behavior changes for users mid-flight. | No prod users exercising this path heavily yet — safe. |
| R5 | "Cleanup runs silently after dismissal" — user has no warning their images are being deleted. | Mitigated by the inline "Cleaned up {n}" note on the library page next visit. Future: a Settings toggle to re-enable the reminder. |

---

## File-level change summary

| File | Change |
|---|---|
| `src/lib/schema.ts` | Add `lockedAt`, `lastUsedAt` to `libraryImages`. Add `lastCleanupCheckMonth`, `monthlyCleanupReminderDismissed` to `profiles`. |
| `drizzle/...` (new migration) | Generated by `drizzle generate`. |
| `src/lib/services/image-service.ts` | Bump `LIBRARY_CAP` to 100. Remove eviction from `retainImagesToLibrary`. Add `runMonthlyCleanup`, `toggleLibraryImageLock`, `deleteAllLibraryImages`, `deleteImageIfAllPlatformsPosted`, `pickFromLibrary` (stub). |
| `src/app/(app)/(onboarded)/library/actions.ts` | Add `checkMonthlyCleanupAction`, `runMonthlyCleanupAction`, `dismissCleanupReminderAction`, `toggleLibraryImageLockAction`, `deleteAllLibraryImagesAction`, `getLibraryDownloadUrlAction`. |
| `src/app/api/library/download/route.ts` | **New.** GET route handler — streams ZIP of all user's library images. |
| `package.json` | Add `archiver` (and `@types/archiver` to devDeps). |
| `src/app/(app)/(onboarded)/library/page.tsx` | Header gets Download/Delete-all buttons. Pill shows `{count}/100`. Pass cleanup state from server. |
| `src/components/library/library-grid.tsx` | Add padlock affordance, last-used badge to each tile. |
| `src/components/library/cleanup-reminder-dialog.tsx` | **New.** Modal with "Don't show again" checkbox + Cancel/Proceed buttons. |
| `src/components/library/download-cleanup-prompt-dialog.tsx` | **New.** Two-button popup that appears after download-all triggers. |
| `src/components/library/delete-all-confirmation-dialog.tsx` | **New.** Simple confirm for the Delete-all button. |
| `src/app/(app)/(onboarded)/layout.tsx` | Server-side: call `checkMonthlyCleanupAction` and pass result to a client component that conditionally mounts the reminder dialog or fires silent cleanup. |

No changes to: `subscription-service.ts`, `post-service.ts`, `post-generator.ts`, `image-generator.ts`, `openai.ts`, `storage.ts`, the Wave 1/2 image-generation paths.

---

## Stage task files

Each stage has a self-contained brief alongside this spec:

- `stage-1-schema-cap.md`
- `stage-2-service-actions.md`
- `stage-3-zip-download.md`
- `stage-4-ui.md`

Implementers should read `spec.md` for context, then work from the stage file. Stages are sequential — do not start Stage N+1 until Stage N is committed and the build is green.
