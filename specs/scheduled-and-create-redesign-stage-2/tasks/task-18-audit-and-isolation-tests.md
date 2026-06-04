# Task 18: Audit + user-isolation regression tests

## Status
not started

## Wave
6

## Description

Run the project's quality gates against the full Stage-2 diff and add the explicit user-isolation regression test suite required by D-S2-18. The audit catches stray imports, prop-type drift, and production-build regressions; the targeted greps confirm Stage-2's scope boundaries (rolling-4 reads only land in the spec-authorized files; `image-service.ts` exists with the contracted helpers; the `.env.example` sentinel for `BLOB_READ_WRITE_TOKEN` is in place). The new vitest suite proves that every cross-user attack vector (User-A calling a service-layer write with one of User-B's IDs) is rejected by an ownership guard before any row is touched.

Together the greps and the tests are the explicit verification of D-S2-18's user-isolation contract. Task-18 gates task-19 — the manual E2E walkthrough must not start until lint, typecheck, build, and these regression tests all PASS.

## Dependencies

**Depends on:** task-17 (the wizard fix must land first so the audit's `pnpm build:ci` pass includes the final shape of `wizard-step.tsx`), and transitively all of tasks 01–16.
**Blocks:** task-19 (E2E verification cannot start until this task's gates are green).
**Parallel with:** none — Wave 6 runs sequentially. Task-18 runs after task-17 and before task-19.

## Files to Modify

None for the audit portion — it's verification-only.

## Files to Create

- `src/lib/services/__tests__/user-isolation.test.ts` (new) — the cross-user regression suite covering `cancelPost`, `deleteBatchForever`, `scheduleBatch`, `deleteLibraryImage`, and `retainImagesToLibrary`. Follows the same PGlite-in-memory pattern as `subscription-service.test.ts` (raw `pg.exec` DDL for only the tables touched, `vi.mock` of `@/lib/db`).

## Implementation Steps

### 1. Run the standard quality gates

```bash
pnpm lint
pnpm typecheck
pnpm build:ci
```

All three must exit 0. Fix any new errors before proceeding. If `pnpm build:ci` is not in `package.json`, substitute `pnpm build` — match whichever script the repo uses.

### 2. Greps that confirm Stage-2 scope

```bash
# 2a. image-service exposes the contracted library helpers.
# Expected: at least one match (the table import + the column references inside
# retainImagesToLibrary / listLibrary / deleteLibraryImage).
rg "library_images|libraryImages" src/lib/services/image-service.ts

# 2b. No surprise reads of scheduled_posts outside getScheduledViewForUser's
# consumers and the new batch-detail page. The /create + /schedule list
# components must NOT directly query scheduled_posts.
# Expected: zero matches.
rg "scheduled_posts|scheduledPosts" src/components/create/ src/components/schedule/

# 2c. The BLOB token sentinel is documented in .env.example so a fresh clone
# can't accidentally run with silent blob_orphan logging in production.
# Expected: one match.
rg "BLOB_READ_WRITE_TOKEN" .env.example

# 2d. blob_orphan logging contract (D-S2-9) is present in image-service.
# Expected: at least one match inside safeDeleteBlob.
rg "blob_orphan" src/lib/services/image-service.ts

# 2e. The per-user advisory lock (D-S2-5) is present inside
# retainImagesToLibrary. The cap is race-safe only because of this lock — if it
# disappears, concurrent retains can both see count=30 and double-insert.
# Expected: at least one match.
rg "pg_advisory_xact_lock" src/lib/services/image-service.ts
```

Any unexpected match (or expected match missing) fails the audit. Document each result in the verification artifact as PASS/FAIL with the file path + line numbers.

### 3. Greps that confirm the dormant Phase-7 contract still holds

```bash
# The currently_posting variant of ScheduledBatchBox remains present in the
# component (dormant; never produced from data in Stage-2).
# Expected: at least one match — the variant constant or className branch.
rg "currently_posting" src/components/schedule/scheduled-batch-box.tsx

# stopBatch is unchanged. Stage-2 introduces cancelPost and deleteBatchForever
# but does NOT touch the existing batch-level stopBatch (it remains the surface
# for the `[Cancel batch]` button on UPCOMING boxes).
# Expected: same function body as before this spec.
git diff main -- src/lib/services/post-service.ts | rg "stopBatch"
# If the diff shows no edits to lines inside stopBatch, PASS. Any edit to the
# function body is a violation.
```

### 4. No accidental new dependencies beyond what the spec called for

Stage-2 names `@vercel/blob` (already in the project) and PGlite (already pulled in by `subscription-service.test.ts`). Confirm nothing new snuck in:

```bash
git diff main -- package.json pnpm-lock.yaml
```

Review the diff line-by-line. Allowed additions: none for runtime; if the test suite added anything to `devDependencies` (e.g. a new vitest plugin), call it out in the verification artifact.

### 5. Write the user-isolation regression suite

Create `src/lib/services/__tests__/user-isolation.test.ts`. Follow the bootstrap pattern from `subscription-service.test.ts`:

- Create a PGlite instance + a drizzle wrapper bound to `import * as schema from "@/lib/schema"`.
- `vi.mock("@/lib/db", () => ...)` so the production import resolves to the in-memory DB.
- Apply DDL via raw `pg.exec` for only the tables touched by the suites: `user`, `weekly_batches`, `posts`, `post_images`, `scheduled_posts`, `library_images`, `post_logs`. Match the columns in `src/lib/schema.ts` closely enough that the service queries resolve.
- Stub `@vercel/blob` so `del()` is a no-op (`vi.mock("@vercel/blob", () => ({ del: vi.fn().mockResolvedValue(undefined) }))`). The isolation tests don't care about real blob calls — they care about which DB rows are reachable.

For each scenario below, seed two users (`user-a`, `user-b`) plus whichever batch/post/library rows the assertion needs. Then call the service-layer function with User-A's session ID and User-B's resource ID. Assert the documented error code AND a follow-up `count(*)` query proves no rows were deleted in either user's namespace.

#### 5a. `cancelPost` — User-A cancels User-B's postId

Seed: User-B has a batch with one post + one `post_images` row + one `scheduled_posts` row with `scheduledTime > now()` and `status='pending'`.

```ts
const result = await postService.cancelPost("user-a", "user-b-post-id");
expect(result).toEqual({ ok: false, error: "not_owned" });

const postsAfter = await testDb.select().from(schema.posts);
expect(postsAfter.find(p => p.id === "user-b-post-id")).toBeDefined();

const libraryAfter = await testDb.select().from(schema.libraryImages);
expect(libraryAfter).toHaveLength(0); // image was NOT preserved to A's library
```

#### 5b. `deleteBatchForever` — User-A on User-B's cancelled batch

Seed: User-B has a batch with `status='cancelled'`, 3 posts, 3 `post_images` rows.

```ts
const result = await postService.deleteBatchForever("user-a", "user-b-batch-id");
expect(result).toEqual({ ok: false, error: "not_owned" });

const batchesAfter = await testDb.select().from(schema.weeklyBatches);
expect(batchesAfter.find(b => b.id === "user-b-batch-id")).toBeDefined();

const libraryAfter = await testDb.select().from(schema.libraryImages);
expect(libraryAfter).toHaveLength(0);
```

#### 5c. `scheduleBatch` — User-A on User-B's reviewing batch

Seed: User-A has 4 batches in `status='scheduling'` (at-cap). User-B has 1 batch in `status='reviewing'`.

```ts
const result = await scheduleService.scheduleBatch("user-a", "user-b-batch-id");
expect(result).toEqual({ ok: false, error: "not_reviewing" });
// (The status-guarded UPDATE filters on userId, so User-A's session never
// matches User-B's batch.userId — 0 rows affected → not_reviewing.)

const userABatches = await testDb
  .select()
  .from(schema.weeklyBatches)
  .where(eq(schema.weeklyBatches.userId, "user-a"));
expect(userABatches).toHaveLength(4); // no eviction triggered for User-A

const userBBatch = await testDb
  .select()
  .from(schema.weeklyBatches)
  .where(eq(schema.weeklyBatches.id, "user-b-batch-id"));
expect(userBBatch[0].status).toBe("reviewing"); // unchanged
```

#### 5d. `deleteLibraryImage` — User-A on User-B's libraryImageId

Seed: User-B has 1 row in `library_images`.

```ts
const result = await imageService.deleteLibraryImage("user-a", "user-b-library-id");
expect(result).toEqual({ ok: false, error: "not_owned" });

const libraryAfter = await testDb.select().from(schema.libraryImages);
expect(libraryAfter).toHaveLength(1);
expect(libraryAfter[0].id).toBe("user-b-library-id");
```

#### 5e. `retainImagesToLibrary` — postIds spanning two users

Seed: User-A has 1 post (with `post_images`), User-B has 1 post (with `post_images`). The library is empty for both.

```ts
const result = await imageService.retainImagesToLibrary(
  "user-a",
  ["user-a-post-id", "user-b-post-id"],
);
// Spec lock (task-03 multi-user safety contract): retainImagesToLibrary MUST
// reject the entire batch when any postId is not owned by sessionUserId.
// Silent filter-to-owned is explicitly forbidden — a mixed-owner array is
// a caller bug and must fail loudly. Same rule applies to
// deleteImagesPermanently.
expect(result).toEqual({ ok: false, error: "not_owned" });

const libraryAfter = await testDb.select().from(schema.libraryImages);
expect(libraryAfter).toHaveLength(0); // neither user got a row

// Same assertion for deleteImagesPermanently — also rejects on mixed owners.
const permResult = await imageService.deleteImagesPermanently(
  "user-a",
  ["user-a-post-id", "user-b-post-id"],
);
expect(permResult).toEqual({ ok: false, error: "not_owned" });
// Blob mock should NOT have been called for either URL (caller failed before
// any deletion ran).
expect(mockBlobDel).not.toHaveBeenCalled();
```

A `{ ok: true }` outcome here is a test failure, not an acceptable alternative. The reject behavior is the locked contract — see task-03's "Multi-user safety contract" block and spec §5.2.

### 6. Run the suite

```bash
pnpm vitest run src/lib/services/__tests__/user-isolation.test.ts
```

All 5 scenarios must pass. Fix any failure before signaling task-18 complete — a failure here means a service-layer guard is missing or wrong, which blocks merge.

### 7. Write findings into `verification.md`

The verification artifact is created by task-19, but task-18's results form Part 1 of it. Stage the following sections (task-19 will append Part 2):

```
## Part 1 — Automated audit (task 18)

### 1.1 Quality gates
| Gate | Command | Exit | Result |
| Lint | `pnpm lint` | 0 | PASS |
| Typecheck | `pnpm typecheck` | 0 | PASS |
| Production build | `pnpm build:ci` | 0 | PASS — N routes generated |

### 1.2 Stage-2 scope greps
- 2a image-service references library_images: PASS (N matches)
- 2b no surprise scheduled_posts reads in create/ + schedule/: PASS (0 matches)
- 2c BLOB_READ_WRITE_TOKEN documented in .env.example: PASS (1 match)
- 2d safeDeleteBlob logs blob_orphan: PASS
- 2e pg_advisory_xact_lock present in image-service: PASS

### 1.3 Dormant contract
- currently_posting variant intact in scheduled-batch-box.tsx: PASS
- stopBatch body unchanged: PASS

### 1.4 User-isolation regression suite
- 5a cancelPost rejects cross-user: PASS
- 5b deleteBatchForever rejects cross-user: PASS
- 5c scheduleBatch rejects cross-user: PASS
- 5d deleteLibraryImage rejects cross-user: PASS
- 5e retainImagesToLibrary rejects cross-user mix: PASS

Task 18 status: PASS. Cleared to run task 19.
```

Task-19's E2E walkthrough appends Part 2 below this.

## Acceptance Criteria

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm build:ci` exits 0.
- [ ] Grep 2a (`library_images|libraryImages` in `image-service.ts`) returns ≥ 1 match.
- [ ] Grep 2b (`scheduled_posts|scheduledPosts` in `src/components/create/` + `src/components/schedule/`) returns 0 matches.
- [ ] Grep 2c (`BLOB_READ_WRITE_TOKEN` in `.env.example`) returns ≥ 1 match.
- [ ] Grep 2d (`blob_orphan` in `image-service.ts`) returns ≥ 1 match.
- [ ] Grep 2e (`pg_advisory_xact_lock` in `image-service.ts`) returns ≥ 1 match.
- [ ] `currently_posting` variant still renders in `scheduled-batch-box.tsx` (dormant Phase-7 contract preserved).
- [ ] `stopBatch` body unchanged in `src/lib/services/post-service.ts`.
- [ ] `src/lib/services/__tests__/user-isolation.test.ts` exists and exercises all 5 scenarios (cancelPost, deleteBatchForever, scheduleBatch, deleteLibraryImage, retainImagesToLibrary cross-user).
- [ ] All 5 scenarios PASS under `pnpm vitest run src/lib/services/__tests__/user-isolation.test.ts`.
- [ ] `package.json` + `pnpm-lock.yaml` diff matches the spec's allowed footprint (no surprise runtime deps).
- [ ] Audit findings are staged as Part 1 of `specs/scheduled-and-create-redesign-stage-2/verification.md` (task-19 finalizes the file).

## Notes

- The PGlite DDL must include the `scheduled_posts.status` column — `cancelPost`'s `already_posted` gate reads it. If the DDL omits it, the gate test will fail with a column-not-found error, not the expected `not_owned`.
- The `post_logs` table must exist in the DDL because `safeDeleteBlob` writes to it. If the test's blob stub is set up correctly (`del` resolves), the orphan log path doesn't fire — but seeded tests for blob-failure scenarios would need the table present. Keep it in the bootstrap.
- D-S2-18 (user-isolation contract) is the load-bearing reason this suite exists. Service-layer guards are the contract; this suite is the verification. Any future Stage-2 service-layer write must add a row to this suite — call that out in the PR description so reviewers know.
- Task-19's `verification.md` references back to this task's results as Part 1. The artifact lives in `specs/scheduled-and-create-redesign-stage-2/verification.md` — coordinate with task-19 so neither task overwrites the other.

## Out of scope

- Unit tests for the happy paths of `cancelPost`, `deleteBatchForever`, `scheduleBatch`. Those belong in the service-layer task files (04, 05, 06) and may already have coverage. This task is specifically the cross-user isolation suite.
- Performance benchmarks or load tests of the rolling-4 eviction. The spec §9 (Risks) judged the worst case acceptable; benchmarking would be premature.
- Playwright / browser-driven E2E. Task-19 handles the manual walkthrough; no automated E2E is in scope for Stage 2.
- Lighthouse / bundle-size audits.
- Re-running drizzle migration generation. Task-01 produced the SQL; the audit only confirms it lands in `drizzle/`.
