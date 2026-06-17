# Stage 1 — Schema + cap raise

**Goal:** ship the schema foundation. After this stage the DB can hold lock + last-used state on library images, can track per-user monthly cleanup checks and reminder dismissal, and the cap is 100. `retainImagesToLibrary` no longer evicts.

Read `spec.md` first for full context.

---

## Files to touch

1. `src/lib/schema.ts` — add 4 columns across 2 tables
2. `drizzle/...` — generated migration
3. `src/lib/services/image-service.ts` — `LIBRARY_CAP` raise; remove eviction from `retainImagesToLibrary`

---

## Steps

### 1. Schema

`src/lib/schema.ts` — extend `libraryImages` table (around line 397):

```ts
// Add to the libraryImages pgTable column block:
lockedAt: timestamp("locked_at"),
lastUsedAt: timestamp("last_used_at"),
```

`lockedAt` doubles as the lock indicator (non-null = locked) and an audit timestamp. `lastUsedAt` is written only by the future Wave 4 picker; Wave 3 just reads it in the cleanup sort.

Same file — extend `profiles` table (search for the `profiles` pgTable):

```ts
// Add to the profiles pgTable column block:
lastCleanupCheckMonth: text("last_cleanup_check_month"),
monthlyCleanupReminderDismissed: boolean("monthly_cleanup_reminder_dismissed").notNull().default(false),
```

Both new profile columns can land in any order in the table — no constraint dependency.

### 2. Migration

```
pnpm run db:generate
pnpm run db:migrate
```

The generated migration should contain 4 `ALTER TABLE ... ADD COLUMN` statements (2 on library_images, 2 on profiles). No data backfill needed — all new columns are nullable or have a default.

**NEVER run `drizzle push`** (per `AGENTS.md`).

### 3. `LIBRARY_CAP` raise

`src/lib/services/image-service.ts` (around line 43):

```ts
// Before
const LIBRARY_CAP = 30;

// After
const LIBRARY_CAP = 100;
```

### 4. Remove eviction from `retainImagesToLibrary`

Same file. The current function does:
- Ownership check
- `pg_advisory_xact_lock` for race protection
- Count existing library_images
- Compute overflow vs LIBRARY_CAP
- Delete oldest rows if overflow > 0
- Insert new rows
- Best-effort safeDeleteBlob on evicted URLs

**Remove the overflow computation, the eviction SELECT/DELETE, and the post-commit safeDeleteBlob loop.** Keep:
- Ownership check
- Advisory lock (still needed for concurrent retain race)
- Insert

After the change the function is much smaller. The advisory lock can stay because future contention scenarios (multi-device retain) still benefit, but the only DB write inside the transaction is the insert.

The behavior change: library can exceed 100 between cleanups. `runMonthlyCleanup` (Stage 2) handles it on the next first-of-month visit.

Add a short JSDoc note explaining the deferred cap enforcement and link to the spec for context.

---

## Acceptance criteria

1. `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` all pass.
2. Migration applied — verify in `__drizzle_migrations__` or via `drizzle-kit studio`.
3. Manual: insert a `library_images` row with `lockedAt = now()` directly via SQL. Confirm it shows `locked_at` non-null.
4. Manual: call `retainImagesToLibrary` (via an existing flow — e.g., delete a cancelled batch) when the user is already at 99 library images. Confirm count goes to ≥100 without eviction.
5. No Wave 1/2 regressions — initial batch generation + retry + regenerate still work end-to-end.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT modify the library page UI.
- Do NOT add the padlock affordance.
- Do NOT add the cleanup reminder dialog.
- Do NOT add `runMonthlyCleanup` or any Stage-2 service functions.
- Do NOT touch `deleteImagesPermanently` — Wave 2 left it intact, Wave 3 doesn't change it.
- Do NOT add the ZIP download or `archiver` dep — Stage 3 owns that.
- Do NOT add a "re-enable reminder" Settings toggle — out of scope for Wave 3 entirely.
