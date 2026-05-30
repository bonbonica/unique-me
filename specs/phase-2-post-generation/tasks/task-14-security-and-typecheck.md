# Task 14: Security Pass + Lint/Typecheck/Build Audit

## Status
done

## Wave
6

## Description

Final pre-merge audit. Verify ownership checks on every new server action, run the security checklist from `Security_Audit_Commands_UniqueMe.pdf` against the Phase 2 surface, run lint + typecheck + build, and verify the trial-1-batch cap can't be bypassed.

## Dependencies

**Depends on:** tasks 01–13 (all)
**Blocks:** Phase 2 merge / PR creation
**Context from dependencies:** All schema, service, server actions, UI in place.

## Files to Modify

- None for code changes (this is an audit). If issues are found, the fixes go into the appropriate task's files.

## Implementation Steps

### 1. Run automated checks

```
npm run lint
npm run typecheck
npm run build:ci
```

All three must exit 0. Fix anything that doesn't pass.

### 2. Service-layer ownership audit

For each new service method, verify the ownership check exists and is correct. Use this checklist (grep for each method name in `src/lib/services/post-service.ts`):

| Method | Ownership check |
|---|---|
| `generateWeekly(userId, ...)` | Implicit — userId comes from session in the calling server action, used directly in INSERTs. |
| `regenerate(postId, sessionUserId, feedback)` | Loads `posts.userId`, returns `not_owned` if mismatch. ✅ |
| `update(postId, sessionUserId, updates)` | Loads `posts.userId`, returns `not_owned` if mismatch. ✅ |
| `selectForNetwork(postId, sessionUserId, platform)` | Loads `posts.userId`, returns `not_owned` if mismatch. ✅ |
| `deselectForNetwork(postId, sessionUserId, platform)` | Same. ✅ |
| `scheduleMyPick(batchId, sessionUserId)` | Loads `weekly_batches.userId`, returns `not_owned`. ✅ |
| `stopBatch(batchId, sessionUserId)` | Same. ✅ |
| `getBatchForReview(batchId, sessionUserId)` | Same, returns `null` on mismatch. ✅ |
| `getCurrentBatch(sessionUserId)` | Filters WHERE clause by `userId`. ✅ |
| `hasAnyBatch(userId)` | Filters WHERE clause by `userId`. ✅ |

If any method is missing the check, fix it.

### 3. Server-action audit

For each server action in `src/app/(app)/(onboarded)/{create,posts}/actions.ts`:

- Reads `session` via `auth.api.getSession({ headers })` at the top
- Redirects to `/login` if no session
- Passes `session.user.id` (not a client-supplied userId) to the service method

Verify by reading each file. Any action that takes a `userId` from client input is broken — fix it.

### 4. Trial-cap bypass test

Manual end-to-end:

1. Sign up as a new user (will be `trial` status).
2. Complete onboarding (pick at least 1 platform).
3. Generate a batch via `/create`.
4. Cancel the batch via `/posts` → Stop entire batch.
5. Navigate back to `/create`.
6. **Expected:** `<TrialGatedScreen />` renders. Cannot generate another batch.
7. Try POSTing directly to `generateWeeklyAction` (bypass the page-level gate) — e.g., via curl with the session cookie.
8. **Expected:** Server action returns `{ ok: false, error: "trial_batch_exists" }`. No new batch row created.

### 5. Cross-user data leakage test

Manual:

1. Sign up as User A. Generate a batch. Note `batchA.id`.
2. Sign in as User B (different session).
3. Try `/posts?batchId=<batchA.id>`.
4. **Expected:** Redirect to `/create`. Does NOT show User A's posts.
5. From User B's browser console, try calling `selectForNetworkAction(<userA-postId>, "facebook")`.
6. **Expected:** Server action returns `{ ok: false, error: "not_owned" }`. No `post_selections` row created.

### 6. Variation insert audit

- Confirm the `// TODO(phase-3-gating)` marker at the variation-insert site in `postService.generateWeekly`.
- `grep -r "TODO(phase-3-gating)" src/` returns at least 2 results (variation insert + `canGenerate` future-Phase-3 reasons).

### 7. Schema integrity check

In Drizzle Studio:
- Confirm `posts.feedback`, `posts.regeneration_count` exist.
- Confirm `post_variations` + `post_selections` tables exist with the indexes.
- After generating one batch: 1 row in `weekly_batches`, 7 rows in `posts`, 0–14 rows in `post_variations`, 0 rows in `post_selections`.

### 8. Mutation rate-limit consideration

For Phase 2, no rate limiting is in scope. Document any concerns in a follow-up task — the security PDF mentions rate-limiting on generation endpoints (line: "Rate limiting on generation endpoints (prevents credit abuse)"). The trial-1-batch cap is the only generation rate-limit Phase 2 implements. Acceptable for the trial-only audience but flag for Phase 3.

### 9. Run the spec's full Definition-of-Done checklist

See `spec.md § 13`. Tick every box manually.

## Acceptance Criteria

- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm run build:ci` exits 0 (compiles 20+ routes including the new `/posts` and updated `/create`)
- [ ] Every new service method has an ownership check
- [ ] Every new server action takes `userId` from session, not from client input
- [ ] Trial-cap bypass test passes (gated screen renders, server action also blocks)
- [ ] Cross-user data leakage test passes (foreign batchId redirects, foreign postId returns `not_owned`)
- [ ] At least 2 `TODO(phase-3-gating)` markers in `src/`
- [ ] All boxes in `spec.md § 13` ticked
- [ ] Manual smoke: full happy-path E2E (onboard → create → wizard → schedule → stop → cancelled) completes without error

## Notes

- Don't merge if any item fails. Fix in the originating task, re-run this audit.
- If a finding is genuinely deferred (e.g., rate limiting), document in a follow-up issue rather than letting it block Phase 2 — but only with explicit user OK.
- Per AGENTS.md: "Even if an agent wrote the code, you can't blame an agent for a security issue." This audit is the human-signoff gate.
