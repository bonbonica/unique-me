# Task 03: image-service.ts (NEW)

## Status
not started

## Wave
2

## Description

Create `src/lib/services/image-service.ts` — the single orchestrator for the blob lifecycle. All deletion paths in Stage-2 (per-post cancel, delete-batch-forever, rolling-4 eviction, library tile delete) route through this module. The ordering invariant **read URL → blob `del()` → DB row removal** is enforced here so callers can't accidentally orphan or double-delete.

The module exports `retainImagesToLibrary`, `deleteImagesPermanently`, `listLibrary`, and `deleteLibraryImage`. Internal `safeDeleteBlob` swallows blob errors and logs `post_logs.action='blob_orphan'` so failures never block the caller. Library writes (`retainImagesToLibrary`) acquire a per-user `pg_advisory_xact_lock` so the 30-image cap is race-safe under concurrent retains.

## Dependencies

**Depends on:** task-01 (Drizzle migration introducing `library_images`).
**Blocks:** task-04 (cancelPost calls `retainImagesToLibrary`), task-05 (deleteBatchForever calls `retainImagesToLibrary`), task-06 (scheduleBatch calls `deleteImagesPermanently`), task-16 (library page calls `listLibrary` + `deleteLibraryImage`).
**Parallel with:** task-04, task-05, task-06 (different files; this task is the dependency they import from).

## Files to Create

- `src/lib/services/image-service.ts` (new).

## Implementation Steps

### 1. Module header + imports

```ts
import { del } from "@vercel/blob";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  libraryImages,
  postImages,
  postLogs,
  posts,
  type LibraryImage,
} from "@/lib/schema";

const LIBRARY_CAP = 30;

export type ImageServiceResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" };
```

### 2. `safeDeleteBlob` (internal, never throws)

Reference impl per spec §5.2 — keep verbatim:

```ts
async function safeDeleteBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch (err) {
    console.error("[imageService.safeDeleteBlob]", err);
    await db
      .insert(postLogs)
      .values({
        action: "blob_orphan",
        details: {
          url,
          reason: err instanceof Error ? err.message : "unknown",
        },
      })
      .catch(() => {
        /* logging is best-effort too — never throw from cleanup */
      });
  }
}
```

### 3. `retainImagesToLibrary(sessionUserId, postIds)`

Wraps the URL read, lock acquisition, cap eviction, and library insert in a single `db.transaction`. The advisory lock auto-releases at txn commit.

**Multi-user safety contract (locked):** if any `postId` in the input resolves to a `posts` row whose `userId !== sessionUserId`, the call rejects the entire batch with `{ ok: false, error: "not_owned" }`. **Do not silently filter to owned rows.** Same rule applies to `deleteImagesPermanently` below. Rationale: a caller passing a mixed-owner array is a bug, not a graceful-degradation case — fail loudly so the call site is fixed. Asserted in task-18's user-isolation suite (5e).

```ts
export async function retainImagesToLibrary(
  sessionUserId: string,
  postIds: string[],
): Promise<ImageServiceResult> {
  if (postIds.length === 0) return { ok: true };

  // 1. Read post_images for the given posts, gated by ownership.
  const imageRows = await db
    .select({
      postId: postImages.postId,
      batchId: posts.batchId,
      imageUrl: postImages.imageUrl,
      imagePrompt: postImages.imagePrompt,
      source: postImages.source,
      userId: posts.userId,
    })
    .from(postImages)
    .innerJoin(posts, eq(postImages.postId, posts.id))
    .where(inArray(postImages.postId, postIds));

  if (imageRows.length === 0) return { ok: true };
  if (imageRows.some((r) => r.userId !== sessionUserId)) {
    return { ok: false, error: "not_owned" };
  }

  // 2. Acquire per-user advisory lock + run cap eviction + insert in one txn.
  const orphansToDelete: string[] = [];

  await db.transaction(async (tx) => {
    // pg_advisory_xact_lock auto-releases at commit/rollback. Hash the userId
    // namespace so different users never contend with each other.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"library:" + sessionUserId}))`,
    );

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(libraryImages)
      .where(eq(libraryImages.userId, sessionUserId));

    const overflow = count + imageRows.length - LIBRARY_CAP;

    if (overflow > 0) {
      const evictions = await tx
        .select({ id: libraryImages.id, imageUrl: libraryImages.imageUrl })
        .from(libraryImages)
        .where(eq(libraryImages.userId, sessionUserId))
        .orderBy(asc(libraryImages.createdAt))
        .limit(overflow);

      for (const row of evictions) orphansToDelete.push(row.imageUrl);

      if (evictions.length > 0) {
        await tx.delete(libraryImages).where(
          inArray(
            libraryImages.id,
            evictions.map((e) => e.id),
          ),
        );
      }
    }

    await tx.insert(libraryImages).values(
      imageRows.map((r) => ({
        userId: sessionUserId,
        imageUrl: r.imageUrl,
        imagePrompt: r.imagePrompt,
        source: r.source,
        originPostId: r.postId,
        originBatchId: r.batchId,
      })),
    );
  });

  // 3. Blob deletes happen OUTSIDE the txn — network calls in an open txn
  // risk leaks. Failures swallowed by safeDeleteBlob.
  for (const url of orphansToDelete) await safeDeleteBlob(url);

  return { ok: true };
}
```

### 4. `deleteImagesPermanently(sessionUserId, postIds)`

No lock, no library write — just URL read (ownership-gated) + blob deletes. Caller deletes the parent rows; cascade handles `post_images` cleanup.

```ts
export async function deleteImagesPermanently(
  sessionUserId: string,
  postIds: string[],
): Promise<ImageServiceResult> {
  if (postIds.length === 0) return { ok: true };

  const imageRows = await db
    .select({
      imageUrl: postImages.imageUrl,
      userId: posts.userId,
    })
    .from(postImages)
    .innerJoin(posts, eq(postImages.postId, posts.id))
    .where(inArray(postImages.postId, postIds));

  if (imageRows.length === 0) return { ok: true };
  if (imageRows.some((r) => r.userId !== sessionUserId)) {
    return { ok: false, error: "not_owned" };
  }

  for (const row of imageRows) await safeDeleteBlob(row.imageUrl);
  return { ok: true };
}
```

### 5. `listLibrary(sessionUserId)`

```ts
export async function listLibrary(
  sessionUserId: string,
): Promise<LibraryImage[]> {
  return db
    .select()
    .from(libraryImages)
    .where(eq(libraryImages.userId, sessionUserId))
    .orderBy(sql`${libraryImages.createdAt} desc`);
}
```

### 6. `deleteLibraryImage(sessionUserId, libraryImageId)`

URL-read-first, ownership-gated, blob then row:

```ts
export async function deleteLibraryImage(
  sessionUserId: string,
  libraryImageId: string,
): Promise<ImageServiceResult> {
  const [row] = await db
    .select({
      userId: libraryImages.userId,
      imageUrl: libraryImages.imageUrl,
    })
    .from(libraryImages)
    .where(eq(libraryImages.id, libraryImageId))
    .limit(1);

  if (!row) return { ok: false, error: "not_found" };
  if (row.userId !== sessionUserId) return { ok: false, error: "not_owned" };

  await safeDeleteBlob(row.imageUrl);

  await db
    .delete(libraryImages)
    .where(
      and(
        eq(libraryImages.id, libraryImageId),
        eq(libraryImages.userId, sessionUserId),
      ),
    );

  return { ok: true };
}
```

### 7. Optional barrel export

If `src/lib/services/index.ts` re-exports services as namespaces, add `export * as imageService from "./image-service"` alongside the existing `postService` / `subscriptionService` entries. Otherwise, callers import functions individually.

## Acceptance Criteria

- [ ] `image-service.ts` exists at `src/lib/services/image-service.ts` and exports `retainImagesToLibrary`, `deleteImagesPermanently`, `listLibrary`, `deleteLibraryImage`. `safeDeleteBlob` is module-private.
- [ ] `safeDeleteBlob` never throws. A throwing `del()` results in one `post_logs` row with `action='blob_orphan'` and `details: { url, reason }`.
- [ ] `retainImagesToLibrary` is a no-op when `postIds.length === 0` and returns `{ ok: true }`.
- [ ] `retainImagesToLibrary` enforces ownership: any `post_images` row whose joined `posts.userId !== sessionUserId` returns `{ ok: false, error: 'not_owned' }` with no DB writes.
- [ ] Cap eviction: when `existingCount + newCount > 30`, oldest-by-`createdAt` `library_images` rows are removed first (count = overflow); their blobs are deleted via `safeDeleteBlob` AFTER txn commit.
- [ ] The library insert + cap eviction share one `db.transaction`. The `pg_advisory_xact_lock(hashtext('library:' || userId))` is acquired inside the txn so it releases automatically.
- [ ] `deleteImagesPermanently` calls `safeDeleteBlob` for every owned URL and returns `{ ok: true }`. It does NOT touch `library_images`.
- [ ] `listLibrary` returns user's rows ordered newest-first.
- [ ] `deleteLibraryImage` returns `not_found` for unknown IDs and `not_owned` when `userId` mismatch — verified BEFORE any blob call.
- [ ] No `del()` call happens inside an open transaction (verify by reading the implementation, not just behavior).
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- The advisory lock key uses the namespace `library:` prefix on `userId` so it never collides with future per-user locks for other resources.
- `pg_advisory_xact_lock` takes a single `bigint`; `hashtext()` returns `int4`, which Postgres auto-widens. If a future schema uses two-arg advisory locks, switch to `pg_advisory_xact_lock(hashtext('library'), hashtext(userId))`.
- Blob deletes happen sequentially. Stage-2 worst case is 7 URLs per call — acceptable. If Phase 7 introduces bulk publishers, revisit with `Promise.all` + a small concurrency cap.
- `post_logs.action` already accepts a string union including `'cancelled'`, `'posted'`, etc. — Stage-2 adds the `'blob_orphan'` value at runtime without a schema change.

## Out of scope

- Direct uploads to `/library` (spec §8: future).
- Soft-delete / restore (future spec; this module's `safeDeleteBlob` will back the purge job).
- Surfacing blob-orphan errors in the UI. They're audit-only.
- Bulk delete with progress UI. Stage-2 callers operate on ≤ 7 images per action.
