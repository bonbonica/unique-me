# Stage 2 — Service layer + server actions

**Goal:** ship the backend logic for monthly cleanup, lock toggle, bulk delete variants, and the posted-image-deletion contract that the future posting service will call. No UI in this stage — Stage 4 owns that.

Read `spec.md` first.

**Prereq:** Stage 1 committed and green.

---

## Files to touch

1. `src/lib/services/image-service.ts` — five new exports + one stub
2. `src/app/(app)/(onboarded)/library/actions.ts` — six new server actions

---

## Steps

### 1. `runMonthlyCleanup(sessionUserId, currentMonthYyyyMm)`

Add to `image-service.ts`. Signature:

```ts
export type CleanupResult =
  | { ok: true; action: "none" | "ran"; deleted: number; over: number }
  | { ok: false; error: "unauthenticated" };

export async function runMonthlyCleanup(
  sessionUserId: string,
  currentMonthYyyyMm: string,
): Promise<CleanupResult>
```

Body steps (matches §Service layer in `spec.md` exactly):
1. Read `profile.lastCleanupCheckMonth`. If equal to `currentMonthYyyyMm` → return `{ ok: true, action: "none", deleted: 0, over: 0 }`.
2. Count `library_images` for the user.
3. If count ≤ 100 → update `lastCleanupCheckMonth = currentMonthYyyyMm` and return `{ ok: true, action: "none", deleted: 0, over: 0 }`.
4. `over = count - 100`.
5. SELECT up to `over` rows for this user where `lockedAt IS NULL` AND NOT "in use" (see §"Unused" below). Sort by `COALESCE(lastUsedAt, createdAt) ASC`.
6. For each: `safeDeleteBlob(row.imageUrl)`, then DELETE the row.
7. Update `lastCleanupCheckMonth = currentMonthYyyyMm`.
8. Return `{ ok: true, action: "ran", deleted: <count of rows actually deleted>, over: <original overage> }`.

#### "Unused" SQL

A library_images row is "in use" if its `originPostId` resolves to a `posts` row whose batch is in one of: `reviewing`, `scheduling`, `scheduled`, `cancelled`.

Suggested Drizzle pattern: use a NOT EXISTS subquery:

```ts
const inUseSubquery = db
  .select({ one: sql`1` })
  .from(posts)
  .innerJoin(weeklyBatches, eq(posts.batchId, weeklyBatches.id))
  .where(
    and(
      eq(posts.id, libraryImages.originPostId),
      inArray(weeklyBatches.status, [
        "reviewing", "scheduling", "scheduled", "cancelled",
      ]),
    ),
  );

const eligibleQuery = db
  .select({ id: libraryImages.id, imageUrl: libraryImages.imageUrl })
  .from(libraryImages)
  .where(
    and(
      eq(libraryImages.userId, sessionUserId),
      isNull(libraryImages.lockedAt),
      notExists(inUseSubquery),
    ),
  )
  .orderBy(asc(sql`COALESCE(${libraryImages.lastUsedAt}, ${libraryImages.createdAt})`))
  .limit(over);
```

Use Drizzle's `notExists` and `isNull` from `drizzle-orm`. Confirm with existing image-service patterns. If `notExists` isn't already imported, add it.

#### Failure handling

Never throws. Wrap in top-level try/catch and return `{ ok: true, action: "ran", deleted: <whatever succeeded>, over }`. Errors logged via `console.error("[image-service] runMonthlyCleanup top-level failed", { sessionUserId, err })` — same pattern as Wave 2's runImageGenerationForRow.

### 2. `toggleLibraryImageLock(sessionUserId, libraryImageId, lock)`

```ts
export async function toggleLibraryImageLock(
  sessionUserId: string,
  libraryImageId: string,
  lock: boolean,
): Promise<ImageServiceResult>
```

Conditional UPDATE:
```ts
const updated = await db
  .update(libraryImages)
  .set({ lockedAt: lock ? new Date() : null })
  .where(
    and(
      eq(libraryImages.id, libraryImageId),
      eq(libraryImages.userId, sessionUserId),
    ),
  )
  .returning({ id: libraryImages.id });

if (updated.length === 0) return { ok: false, error: "not_found" };
return { ok: true };
```

`ImageServiceResult` already exists in the file with `not_found` / `not_owned` variants — use the same. For lock toggle, `not_found` covers both "doesn't exist" and "wrong owner" (consistent with `deleteLibraryImage`).

### 3. `deleteAllLibraryImages(sessionUserId, mode)`

```ts
export async function deleteAllLibraryImages(
  sessionUserId: string,
  mode: "unlocked-only" | "all",
): Promise<{ ok: true; deleted: number }>
```

Steps:
1. SELECT id + imageUrl for matching rows:
   - `"unlocked-only"`: `WHERE userId = ? AND lockedAt IS NULL`
   - `"all"`: `WHERE userId = ?`
2. If empty, return `{ ok: true, deleted: 0 }`.
3. For each row: `safeDeleteBlob(imageUrl)` (sequential, mirrors existing pattern).
4. DELETE the matched rows (use `inArray(libraryImages.id, ids)`).
5. Return `{ ok: true, deleted: rows.length }`.

Order: blob deletes BEFORE DB delete — matches existing `deleteLibraryImage` ordering. Errors in safeDeleteBlob are swallowed by design.

### 4. `deleteImageIfAllPlatformsPosted(postId)`

```ts
export async function deleteImageIfAllPlatformsPosted(
  postId: string,
): Promise<void>
```

Steps:
1. SELECT all `scheduledPosts` rows where `postId = ?`. If any row has `status !== "posted"`, return.
2. SELECT the `post_images` row for this `postId` (one row per post per current schema): need `imageUrl`, `source`, `publishedAt`.
3. If `imageUrl IS NULL` or `publishedAt IS NOT NULL` → return (defensive).
4. Dispatch by `source`:
   - `"ai"` or `"uploaded"`: `safeDeleteBlob(imageUrl)`
   - `"library"`: no blob delete (library_images still owns it)
5. UPDATE `post_images SET imageUrl = NULL, publishedAt = now() WHERE postId = ?`.

Never throws. Top-level try/catch with `console.error("[image-service] deleteImageIfAllPlatformsPosted failed", { postId, err })`.

**Note for the implementer:** no caller exists in this codebase yet. The function is the contract the future posting service will call. Verify by `grep -r "deleteImageIfAllPlatformsPosted" src/` — should find only the definition + tests + this spec.

### 5. `pickFromLibrary` stub

```ts
export type PickFromLibraryResult =
  | { ok: true }
  | { ok: false; error: "not_implemented" };

export async function pickFromLibrary(
  libraryImageId: string,
  postImageId: string,
  sessionUserId: string,
): Promise<PickFromLibraryResult> {
  // Wave 4: copy library_images.imageUrl + imagePrompt into post_images,
  // set source='library', update lastUsedAt on the library row.
  // Wave 3 ships the signature as a stable import surface only.
  void libraryImageId;
  void postImageId;
  void sessionUserId;
  return { ok: false, error: "not_implemented" };
}
```

The `void` discards silence eslint unused-arg warnings. Includes a TODO-style comment referencing Wave 4.

### 6. Server actions

`src/app/(app)/(onboarded)/library/actions.ts` — extend the existing file. Add these alongside the existing `deleteLibraryImageAction`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";
// ... existing imports

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return session;
}

export async function checkMonthlyCleanupAction(currentMonthYyyyMm: string) {
  const session = await requireSession();
  if (!session) return { shouldShowReminder: false, cleanupNeeded: false, count: 0, over: 0, unauthenticated: true };
  // Inspect-only: read profile + library count, do NOT mutate state.
  // Returns the data the layout needs to decide modal-vs-silent-vs-nothing.
  return await imageService.inspectMonthlyCleanupState(session.user.id, currentMonthYyyyMm);
}

export async function runMonthlyCleanupAction(currentMonthYyyyMm: string) {
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "unauthenticated" as const };
  const result = await imageService.runMonthlyCleanup(session.user.id, currentMonthYyyyMm);
  revalidatePath("/library");
  return result;
}

export async function dismissCleanupReminderAction() {
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "unauthenticated" as const };
  await imageService.markCleanupReminderDismissed(session.user.id);
  return { ok: true as const };
}

export async function toggleLibraryImageLockAction(libraryImageId: string, lock: boolean) {
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "unauthenticated" as const };
  const result = await imageService.toggleLibraryImageLock(session.user.id, libraryImageId, lock);
  revalidatePath("/library");
  return result;
}

export async function deleteAllLibraryImagesAction(mode: "unlocked-only" | "all") {
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "unauthenticated" as const };
  const result = await imageService.deleteAllLibraryImages(session.user.id, mode);
  revalidatePath("/library");
  return result;
}

export async function getLibraryDownloadUrlAction() {
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "unauthenticated" as const };
  return { ok: true as const, url: "/api/library/download" };
}
```

**Important note on `checkMonthlyCleanupAction`:** the spec body in `spec.md` says this action returns `{ cleanupNeeded, shouldShowReminder, over, count }`. Implement that as a new service helper `inspectMonthlyCleanupState(userId, currentMonthYyyyMm)` in image-service.ts — pure read, no mutation. Steps:
1. Read profile (`lastCleanupCheckMonth`, `monthlyCleanupReminderDismissed`).
2. If `lastCleanupCheckMonth === currentMonthYyyyMm` → `{ cleanupNeeded: false, shouldShowReminder: false, count: <library_count>, over: 0 }`.
3. Count library_images. Compute `over = count - 100`.
4. `cleanupNeeded = over > 0`.
5. `shouldShowReminder = cleanupNeeded && !monthlyCleanupReminderDismissed`.
6. Return `{ cleanupNeeded, shouldShowReminder, count, over }`.

**Also implement** `markCleanupReminderDismissed(userId)` as a thin service helper: `UPDATE profiles SET monthly_cleanup_reminder_dismissed = true WHERE user_id = ?`. Used by `dismissCleanupReminderAction`.

### 7. Service exports

Ensure `imageService` namespace in `src/lib/services/index.ts` covers the new functions automatically (it uses `export * as imageService from "./image-service"` — verify in Stage 1 that this is still the case; no change needed if so).

---

## Acceptance criteria

1. `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` all pass.
2. Manual smoke test via a `tsx` script or direct DB:
   - Insert 105 library_images for a test user (some locked, some not, some referencing active posts).
   - Call `runMonthlyCleanup(userId, "2026-07")`. Verify the deleted count and that locked + in-use rows survived.
   - Re-call. Should return `{action: "none"}` (already checked this month).
3. Call `toggleLibraryImageLock` twice — confirm lockedAt flips and back.
4. Call `deleteAllLibraryImages(userId, "unlocked-only")` — only locked rows remain.
5. Call `deleteImageIfAllPlatformsPosted(postId)` with all scheduledPosts at status='posted'. Verify post_images.imageUrl=null and publishedAt set. Test with each source value.
6. No Wave 1/2 regressions.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT add the ZIP download endpoint — Stage 3.
- Do NOT add ANY UI — Stage 4.
- Do NOT call `deleteImageIfAllPlatformsPosted` from anywhere — there's no posting service yet.
- Do NOT implement `pickFromLibrary` — stub only.
- Do NOT touch the posting service (doesn't exist yet anyway).
- Do NOT modify `retainImagesToLibrary` again — Stage 1 already did the eviction-removal.
