# Task 01: library_images table + Drizzle migration

## Status
not started

## Wave
1

## Description

Add the `library_images` Drizzle table to `src/lib/schema.ts` per spec §5.1 (D-S2-4). This table is the storage for the new Image Library — one row per retained image, per user, capped at 30 (eviction logic lives in `image-service.ts`, not the schema). It deliberately has no FK to `posts` because every row is written AFTER its originating post is deleted; the `originPostId` / `originBatchId` columns are audit-only `text` fields.

Generate the SQL via `pnpm db:generate`, review the output, and commit both the schema change and the generated SQL file. **Do NOT run `pnpm db:push`** — that bypasses the migration history and breaks the rest of the team.

## Dependencies

**Depends on:** none.
**Blocks:** task-02 (extends `getScheduledViewForUser` and consumers import the same schema file — the migration must land first so types compile cleanly), task-03 (`image-service.ts` reads/writes `library_images`), task-15 (`/schedule/[batchId]` per-post cancel calls into image-service), task-16 (`/library` page reads `library_images`).
**Parallel with:** task-02 (different file regions; task-02 only touches `getScheduledViewForUser` in `post-service.ts`).

## Files to Modify

- `src/lib/schema.ts` (modified) — add the `libraryImages` `pgTable` definition + the two inferred types at the bottom of the file.

## Files to Create

- `drizzle/0007_library_images.sql` (generated) — produced by `pnpm db:generate`. Reviewed and committed alongside the schema change.

## Implementation Steps

### 1. Add the `libraryImages` table

Insert the new `pgTable` in `src/lib/schema.ts` after `postImages` and before `scheduledPosts` (keeps image-related tables co-located). Imports already present in the file cover everything needed (`pgTable`, `text`, `timestamp`, `index`, `user` from `./auth-schema`).

```ts
/**
 * Stage-2 D-S2-4. One row per image the user has chosen to retain after the
 * originating post was hard-deleted (per-post cancel, delete-batch-forever,
 * rolling-4 eviction overflow). Cap = 30 per user, enforced by image-service
 * via per-user pg_advisory_xact_lock + oldest-by-createdAt eviction.
 *
 * Deliberately has NO FK to `posts` — by the time we insert here, the
 * originating post row has already been deleted by the caller. `originPostId`
 * and `originBatchId` are audit-only text fields, NOT references.
 *
 * Blob lifecycle: when this row exists, `library_images.imageUrl` OWNS the
 * Vercel Blob URL. Deleting this row MUST go through `image-service.ts` so
 * the blob `del()` fires first.
 */
export const libraryImages = pgTable(
  "library_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a user removes their library.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    // Union: "ai" | "uploaded". NOT "library" — this table IS the library, so
    // "library" as a source value here would be self-referential nonsense.
    source: text("source").notNull(),
    // Audit-only. No FK — see docblock above.
    originPostId: text("origin_post_id"),
    originBatchId: text("origin_batch_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Composite index on (userId, createdAt). Supports:
    //  - listLibrary: WHERE userId = ? ORDER BY createdAt DESC
    //  - eviction:   WHERE userId = ? ORDER BY createdAt ASC LIMIT N
    index("library_images_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ]
);
```

### 2. Add the inferred row types

In the "Inferred row types" block near the bottom of `schema.ts` (alongside `PostImage` / `NewPostImage`), add:

```ts
export type LibraryImage = typeof libraryImages.$inferSelect;
export type NewLibraryImage = typeof libraryImages.$inferInsert;
```

### 3. Generate the migration

From the repo root:

```bash
pnpm db:generate
```

This should produce `drizzle/0007_library_images.sql` (next number after the existing `0006_previous_iron_fist.sql`). Open the SQL and verify it contains:

- `CREATE TABLE "library_images" (...)` with all 7 columns.
- `ALTER TABLE "library_images" ADD CONSTRAINT ... FOREIGN KEY ("user_id") REFERENCES "user"("id") ... ON DELETE cascade ...`.
- `CREATE INDEX "library_images_user_created_idx" ON "library_images" USING btree ("user_id","created_at");`.
- No other tables changed (sanity check — Stage-2 only adds this one table).

### 4. DO NOT run `pnpm db:push`

The project policy (CLAUDE.md) and the spec (D-S2-20) explicitly forbid `db:push`. If your local DB needs the table, run `pnpm db:migrate` instead — it applies the new SQL file and records the entry in `drizzle/meta/_journal.json`. The reviewer / next coder will run `db:migrate` against their own DB.

### 5. Commit

Stage:
- `src/lib/schema.ts`
- `drizzle/0007_library_images.sql`
- `drizzle/meta/_journal.json` (updated by `db:generate`)
- `drizzle/meta/0007_snapshot.json` (created by `db:generate`)

Commit message suggestion: `Stage-2 task-01: add library_images table + 0007 migration`.

## Acceptance Criteria

- [ ] `src/lib/schema.ts` exports `libraryImages` as a `pgTable("library_images", ...)`.
- [ ] Columns present: `id` (text PK, randomUUID default), `userId` (text, NOT NULL, FK → `user.id` ON DELETE CASCADE), `imageUrl` (text NOT NULL), `imagePrompt` (text NOT NULL), `source` (text NOT NULL), `originPostId` (text, nullable, NO FK), `originBatchId` (text, nullable, NO FK), `createdAt` (timestamp default now, NOT NULL).
- [ ] Composite index `library_images_user_created_idx` on `(user_id, created_at)` present in both the schema table builder and the generated SQL.
- [ ] `LibraryImage` and `NewLibraryImage` exported as inferred types alongside the other `*Image` types.
- [ ] `drizzle/0007_library_images.sql` exists, contains the CREATE TABLE + FK + index DDL, and was produced by `pnpm db:generate` (not hand-written).
- [ ] `drizzle/meta/_journal.json` updated to include the new migration entry.
- [ ] `pnpm db:push` was NOT run at any point.
- [ ] `pnpm lint` and `pnpm typecheck` exit 0 against the new schema.

## Notes

- The `source` column intentionally allows only `"ai" | "uploaded"` as a value (validated at the service layer in image-service, not at the DB — matches the existing enum-as-text convention used by `weeklyBatches.status` and `posts.status`).
- No `attempt` or `selected` columns from `postImages` are carried over — those are wizard-specific state and meaningless once the image is in the library.
- The index covers BOTH the read path (DESC for `/library` listing) and the eviction scan (ASC for oldest-first). Postgres can walk a btree in either direction off the same index.
- `imageUrl` is NOT unique. The same blob URL can in theory appear in `post_images` and `library_images` simultaneously during the brief window between the library insert and the post-row delete — that's by design (read URL → insert library row → delete post row, per the spec's "URL-read-first" ordering).

## Out of scope

- Writing or modifying `image-service.ts`. That's task-03.
- Wiring `libraryImages` reads into `getScheduledViewForUser` or the `/library` page. That's task-02 / task-16.
- Backfill of existing `postImages` rows into `library_images`. Stage-2 only populates the library going forward; existing image data stays on its parent posts.
- Adding a `source` CHECK constraint at the DB level. Service-layer validation only (consistent with the rest of the schema).
