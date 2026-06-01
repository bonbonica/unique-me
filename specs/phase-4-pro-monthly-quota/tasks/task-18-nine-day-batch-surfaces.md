# Task 18: 9-Day Batch — Wizard / Summary / Locked Iteration

## Status
not started

## Wave
4

## Description

Confirm every per-post iteration in `src/components/posts/*.tsx` is driven by `batch.totalPosts`, not a literal 7. Without this, Pro batch 4 (9 posts) renders only the first 7 cards / steps in the wizard, summary, and locked summary.

Likely a 1–2 line fix per surface — the components already accept `posts` arrays from the database; the iteration is usually over the array length. The risk is in any constant-driven layout (e.g. "Day 1 through Day 7" labels).

## Dependencies

**Depends on:** task-12 (Pro 9-post batches actually exist after this)
**Blocks:** task-19
**Context from dependencies:** task-12 produces 9-post batches; task-18 makes the UI render them correctly.

## Files to Modify

Likely (verify at task time):
- `src/components/posts/wizard-step.tsx`
- `src/components/posts/wizard-summary.tsx`
- `src/components/posts/locked-summary.tsx`
- `src/components/posts/day-label.tsx` (probably no change — already takes `postOrder`)

## Implementation Steps

### 1. Grep for hardcoded 7

```
grep -rn "\\b7\\b" src/components/posts/
```

Flag any:
- `Array(7)` / `Array.from({ length: 7 })` — should be `posts.length` or `batch.totalPosts`.
- `for (let i = 0; i < 7; i++)` — same.
- "Day 7" / "of 7" string literals — these need to become "Day {N}" / "of {totalPosts}" with the batch length interpolated.
- Day-of-week iteration that assumes 7-day batches — switch to iterate `totalPosts`.

### 2. Each component

For each posts component:

- Open the file.
- Identify any literal `7` related to post iteration or count display.
- Replace with `batch.totalPosts` (passed down from the parent or already available) OR `posts.length` if that's the source of truth at that scope.
- Confirm key props (React `key={...}`) still work — usually by post id or post order, unchanged.

### 3. `<DayLabel />`

The label takes `postOrder` (1..N) and `batchCreatedAt`. It does NOT take total. It computes the weekday by adding `postOrder - 1` days. **No change should be needed** — the label is per-post and already works for any N.

Verify by mentally walking the formula: `Day 9 · {weekday at createdAt + 8d}` works without changes.

### 4. Wizard navigation / progress

If the wizard renders "Step 3 of 7" in a navigation header, that "7" needs to become `totalPosts`. Same for any progress bar that uses `currentStep / 7` — change denominator to `totalPosts`.

### 5. Locked-summary header copy

The locked summary may say "Your 7 posts are scheduled" or similar. Search for that and parameterise.

## Acceptance Criteria

- [ ] `grep -rn "\\b7\\b" src/components/posts/` returns no post-count literals.
- [ ] A 9-post batch renders 9 wizard steps, 9 summary cards, 9 locked-summary cards.
- [ ] A 7-post batch still renders 7 of each (regression check).
- [ ] Day labels render correctly through Day 9 (e.g. "Day 9 · Mon").
- [ ] Wizard progress / step counters use `totalPosts` as denominator.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- This task is a sweep — small individual edits across multiple files. Keep the diff per file minimal: change only the literal `7` and any adjacent copy.
- The `posts` array length is the most reliable source of truth at the leaf level. `batch.totalPosts` is the source at the wrapper level. Use whichever is closest in scope.
- If a layout grid was tuned for 7 cards (e.g. 7-column grid on desktop), that may need to flex to 9. Likely the grids already auto-flow — verify visually.
- For empty / skeleton states, prefer `Array.from({ length: batch.totalPosts })` over a hardcoded 7. Skeleton at unknown count → small spinner instead.
