# Task 12: Typecheck + lint + build audit

## Status
not started

## Wave
5

## Description

Run the project's quality gates against the full diff. Catches stray imports, prop-type drift, unused code, and any production-build regressions. Gates task-13's manual E2E.

Also runs the targeted greps that confirm the dormant contract (no Stage-1 reads of `scheduled_posts`, no surprise edits to `stopBatch`, no orphaned "My Posts" references).

## Dependencies

**Depends on:** tasks 01–11 all complete.
**Blocks:** task-13.

## Files to Modify

None — this is a verification task.

## Implementation Steps

### 1. Run the standard quality gates

```bash
pnpm lint
pnpm typecheck
pnpm build:ci
```

All three must exit 0. Fix any new errors before proceeding.

### 2. Greps that confirm Stage-1 scope

```bash
# No new reads of scheduled_posts in this spec's surface area.
# Expected: zero matches.
rg "scheduled_posts|scheduledPosts" \
  src/components/schedule/ \
  src/components/create/ \
  src/app/\(app\)/\(onboarded\)/schedule/ \
  src/app/\(app\)/\(onboarded\)/create/

# stopBatch is unchanged.
# Expected: same lines as before this spec.
rg -n "export async function stopBatch|function stopBatch" \
  src/lib/services/post-service.ts
```

If either grep returns unexpected matches, file a follow-up with the offending lines and root-cause.

### 3. Greps that confirm sidebar cleanup

```bash
# "My Posts" should not appear in nav or sidebar definitions.
# Expected: zero matches in src/components/dashboard/.
rg "My Posts" src/components/dashboard/

# The sidebar nav array has exactly 4 items.
# Expected: a single match for the const definition.
rg "DASHBOARD_NAV_ITEMS" src/components/dashboard/sidebar.tsx
```

### 4. Verify the Trial pill link target

```bash
# Confirm the Trial-used pill links to /pricing.
# Expected: at least one match in quota-countdown-pill.tsx.
rg '"/pricing"' src/components/dashboard/quota-countdown-pill.tsx
```

### 5. Verify the dialog props match the dormant contract

```bash
# alreadyPostedCount and queuedCount must be on the props type.
# Expected: both names appear.
rg "alreadyPostedCount|queuedCount" \
  src/components/schedule/cancel-batch-dialog.tsx
```

### 6. No new dependencies

```bash
# Spec scope: no new packages. Confirm package.json is unchanged.
git diff --stat package.json pnpm-lock.yaml
# Expected: no output (no changes).
```

If a task introduced a new dependency, raise it — the spec did not call for one.

### 7. Confirm Drizzle schema is untouched

```bash
git diff --stat src/lib/schema.ts drizzle/
# Expected: no output.
```

D-S16 says no migration. If the schema or `drizzle/` changed, file a follow-up.

## Acceptance Criteria

- [ ] `pnpm lint` exits 0.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm build:ci` exits 0.
- [ ] No new `scheduled_posts` reads in the spec's touched directories.
- [ ] `stopBatch()` is unchanged at `src/lib/services/post-service.ts:898–939`.
- [ ] "My Posts" no longer appears in `src/components/dashboard/`.
- [ ] Trial pill links to `/pricing`.
- [ ] Dialog props include `alreadyPostedCount` and `queuedCount`.
- [ ] `package.json` and `pnpm-lock.yaml` unchanged in this spec's commits.
- [ ] `src/lib/schema.ts` and `drizzle/` unchanged.
- [ ] Findings written into `specs/scheduled-and-create-redesign/verification.md` as a checked-off audit list.

## Notes

- The greps are a defensive safety net. They're cheap and catch the most common drift: a developer reaching for `scheduled_posts` because the table exists, or accidentally tightening `stopBatch()` because Phase 7's contract was visible in the spec.
- If `pnpm build:ci` is the project's build script (matches Phase 4 task-19 convention), use it. If the repo uses `pnpm build` directly, substitute.
- The dormant-variant ad-hoc render check lives in task-13, not here. This task is type-and-grep only.

## Out of scope

- Running unit tests. No new test infrastructure in this spec.
- Performance audits / Lighthouse.
- Bundle size analysis.
- Visual regression. Handled by task-13's manual walkthrough.
