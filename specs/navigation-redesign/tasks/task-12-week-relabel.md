# Task 12: "Batch" → "Week" relabel sweep (UI copy only)

## Status

pending

## Wave

5

## Description

Sweep the app for user-facing "batch" / "Batch" copy and replace with "week" / "Week" or natural rewrites ("this week's posts"). **Quota copy stays in batches** ("X/4 batches per month", "Trial includes 1 batch") because the 5-weeks-per-month quota rework is a separate future project — relabeling quota here would be confusing.

This is a string-only task: no logic, no schemas, no variable renames. Code identifiers (`batchId`, `weeklyBatches`, etc.) stay as-is.

## Dependencies

**Depends on:** task-10, task-11 (so the new UI surfaces exist and are part of the sweep)
**Blocks:** None

**Context from dependencies:** Wave 4 added new UI surfaces (Posting Soon cancel UX, Cancelled Posts single-post rows). All copy on those new surfaces is also subject to the relabel rule.

## Files to Create

None.

## Files to Modify

A scoped sweep across `src/`. Expected files (from exploration of pre-redesign state, plus the new surfaces from this redesign):

- `src/components/dashboard/sidebar.tsx` — already updated in task-04; no batch copy here.
- `src/components/locked-summary.tsx` (or wherever the LockedSummary lives) — strings like "Stop entire batch", "Batch cancelled", "This batch was cancelled. Nothing was posted." → "Stop this week's posts", "Cancelled", "This set of posts was cancelled. Nothing was posted." (Confirm exact strings via grep.)
- `src/components/delete-batch-forever-dialog.tsx` — "Delete your trial batch?" / "Delete this batch?" → "Delete this week's posts?". Body text adjustment to match.
- `src/components/generating-state.tsx` — "Drafting this week's posts…" stays (already says week).
- `src/components/generate-form.tsx` — "Generate this week" stays (already says week).
- `src/app/(app)/(onboarded)/library/page.tsx` — "Images move to your library when you delete a cancelled batch." → "Images move to your library when you delete a cancelled week's posts." (Or similar rewrite that reads naturally.)
- New surfaces added in this redesign (Wave 1–4) — any "batch" copy there gets the same treatment. Most should already use "week" language by design.

**Files to NOT modify (quota copy):**

- `src/components/next-batch-banner.tsx` — already deleted in task-08.
- `src/components/create-next-batch-cta.tsx` (and any rename) — quota CTA copy like "Create next batch — X/4" stays.
- `src/components/quota-gated-screen.tsx` — quota-related copy stays.
- Trial-pill / trial-Dialog copy referencing "Trial includes 1 batch" stays (it's a quota concept). The trial Dialog created in task-09 should use this phrasing: "Trial includes one set of posts" was suggested in task-09; if the team prefers "Trial includes 1 batch" for quota-consistency, change it here.

## Technical Details

### Implementation Steps

1. **Inventory.** Run a case-insensitive grep across `src/` for `\bbatch\b` (word boundaries) in `.tsx` / `.ts` / `.mdx` files. Filter out:
   - Variable / property / type names (anything not inside a JSX text node, JSX attribute string, or `"..."` template string passed as user-facing copy).
   - Quota-context strings (anything in the QuotaGated, NextBatch CTA, or trial-pill surfaces).
   - Console logs, comments, error messages thrown internally (not user-visible).
2. For each remaining hit, decide between:
   - **Drop entirely** if the surrounding sentence reads better without the word (e.g. "Drafting this week's posts" already exists; no change).
   - **"Week"** when the unit being described is the user's calendar week of content (e.g. "Stop entire batch" → "Stop this week's posts").
   - **"Set of posts"** when "week" doesn't fit grammatically (e.g. delete-forever dialog title: "Delete this week's posts?" — works because the user thinks of it as a weekly cadence).
3. **Edit one file at a time** for clean diffs. Keep edits surgical — only the user-facing string changes; ARIA labels and console.error messages stay in technical/code terms (which may include "batch") to avoid leaking UI vocabulary into developer-only surfaces.
4. **Cross-page consistency check.** After all edits, walk through these pages in the dev server and confirm the friendly copy reads naturally and consistently:
   - `/create` (Create Posts)
   - `/schedule-posts` and `/schedule-posts/[batchId]`
   - `/posting-soon` and `/posting-soon/[batchId]`
   - `/cancelled-posts`
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.

### Top 15 strings from pre-redesign (per exploration) and proposed treatments

| # | Current string | Treatment |
|---|---|---|
| 1 | "Start new batch" (multiple files) | Replaced by task-09's "Create new posts" on /create. Anywhere else: → "Create new posts". |
| 2 | "Stop entire batch" (locked-summary) | → "Stop this week's posts" |
| 3 | "Create this week's posts" (dashboard) | Dashboard deleted in task-08; if this string survives elsewhere, keep. |
| 4 | "Start this week" (dashboard) | Dashboard deleted in task-08. |
| 5 | "Your 7 days are up — you can create your next batch." (NextBatchBanner) | Banner deleted in task-08. |
| 6 | "Create this week's posts →" (NextBatchBanner) | Banner deleted in task-08. |
| 7 | "Batch cancelled" (locked-summary) | → "Cancelled" |
| 8 | "This batch was cancelled. Nothing was posted." (locked-summary) | → "This set of posts was cancelled. Nothing was posted." |
| 9 | "Create next batch — X/4" (Pro CTA) | **Quota copy — keep as-is.** |
| 10 | "Delete your trial batch?" / "Delete this batch?" (delete dialog) | → "Delete this week's posts?" |
| 11 | "Drafting this week's posts…" (generating-state) | Already "week" — keep. |
| 12 | "Generate this week" (generate-form) | Generate form removed by task-09's rebuild. If it survives elsewhere, keep. |
| 13 | "Your next batch unlocks soon." (quota-gated-screen) | **Quota copy — keep as-is.** |
| 14 | "Applies to your next batch." (posting-days-section) | **Quota-adjacent — keep as-is** unless the user wants a softer rewrite later. |
| 15 | "Images move to your library when you delete a cancelled batch." (library) | → "Images move to your library when you delete a cancelled week's posts." |

### Notes on what NOT to change

- Do NOT rename variables, types, columns, or service-layer function names. `weeklyBatches` table, `batchId` props, `cancelBatch` actions, `BatchBoxData` types — all stay.
- Do NOT touch quota copy. The 5-weeks-per-month rework is a separate future project.
- Do NOT modify ARIA labels or console errors unless they leak into the user-visible UI.
- Do NOT modify migration files, drizzle artifacts, or generated code.

## Acceptance Criteria

- [ ] Grep for `\bbatch\b` in user-facing copy across `src/**/*.tsx` and `src/**/*.ts` shows only intentional remaining usages (quota copy + technical strings).
- [ ] Walking the 4 main pages (/create, /schedule-posts, /posting-soon, /cancelled-posts) shows consistent "week" / "this week's posts" / "set of posts" language; no leftover "batch" in friendly copy.
- [ ] Quota copy on the trial Dialog and any quota-cap dialog still reads in batches (or matches whatever task-09 committed to).
- [ ] No code identifiers were renamed.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- If a string is ambiguous (could be quota or friendly), default to keeping it as-is and flag it in the handoff for the user to decide. Erring on the side of leaving copy alone is safer than overshooting the relabel.
- Empty-state and confirmation-dialog copy on the new Wave 1–4 surfaces should already be using "week" language per their respective task specs — verify in step 4 of implementation.
