# Task 11: /schedule page — 2x2 grid + drop Past Batches

## Status
not started

## Wave
4

## Description

Replace the Stage-1 single-column boxes + Past Batches disclosure with the Stage-2 2x2 grid layout (D-S2-11, spec §6.5). Up to 4 batch boxes render in a `grid-cols-1 md:grid-cols-2 gap-6` grid sorted by `createdAt DESC` (provided by task-02's extended `getScheduledViewForUser`). The Stage-1 `<PastBatchesList />` is removed entirely — the rolling-4 IS the history now. The empty-state copy and `[Start a new batch →]` CTA are preserved verbatim.

This task also mounts `<CreateNextBatchCta />` (built in task-12) above the grid. The CTA component file is owned by task-12; the page-level mount + prop wiring lives here.

## Dependencies

**Depends on:** task-02 (consumes the new `current` shape + `scheduledBatchCount` from `getScheduledViewForUser`), task-12 (imports `<CreateNextBatchCta />`).
**Blocks:** none within Wave 4.
**Parallel with:** task-12, task-13, task-14.

**PARALLELISM NOTE:** task-14 also lists Wave 4 edits to `scheduled-batch-box.tsx`, and task-13 inserts a new component inside `scheduled-batch-box.tsx`. This task does NOT edit `scheduled-batch-box.tsx` — only the page-level container (`scheduled-page-client.tsx` + the route). Confirmed non-overlapping with task-13 and task-14.

## Files to Modify

- `src/components/schedule/scheduled-page-client.tsx` (modified — drop past-batches section, swap single-column list for 2x2 grid, mount `<CreateNextBatchCta />`).
- `src/app/(app)/(onboarded)/schedule/page.tsx` (modified ONLY if the new `view.scheduledBatchCount` field requires a prop pass-through — the current page already forwards the full `view` object, so no edit is expected).

## Files to Delete

- `src/components/schedule/past-batches-list.tsx` — delete the file once this task's edits land AND a project-wide grep confirms no other consumer imports it. Run `grep -r "past-batches-list" src/` and `grep -r "PastBatchesList" src/` before deletion; if both return zero hits outside this file, delete it.

## Implementation Steps

### 1. Drop the past-batches import + section

In `scheduled-page-client.tsx`, remove:

```ts
import { PastBatchesList } from "./past-batches-list";
```

And remove the entire `<section aria-label="Past batches">...</section>` block. The empty-state condition simplifies from `view.current.length === 0 && view.past.length === 0` to just `view.current.length === 0`.

### 2. Mount the capacity CTA above the grid

Add the import (component built in task-12):

```ts
import { CreateNextBatchCta } from "./create-next-batch-cta";
```

Render it above the grid section, inside the non-empty branch:

```tsx
<CreateNextBatchCta scheduledBatchCount={view.scheduledBatchCount} />
```

When the grid is empty, the CTA is NOT rendered — the empty-state `[Start a new batch →]` button covers the same affordance. Two CTAs side-by-side on an empty page would clutter.

### 3. Swap single-column list for 2x2 grid

Replace:

```tsx
<section className="space-y-6" aria-label="Current period batches">
  {view.current.map((batch) => (
    <ScheduledBatchBox ... />
  ))}
</section>
```

With:

```tsx
<section
  className="grid grid-cols-1 md:grid-cols-2 gap-6"
  aria-label="Current period batches"
>
  {view.current.map((batch) => (
    <ScheduledBatchBox
      key={batch.id}
      data={batch}
      onCancelClick={() =>
        setCancelTarget({
          id: batch.id,
          totalPosts: batch.totalPosts,
          alreadyPostedCount: batch.alreadyPostedCount,
          queuedCount: batch.queuedCount,
        })
      }
    />
  ))}
</section>
```

`grid-cols-1 md:grid-cols-2 gap-6` per DESIGN.md §8 (single column on mobile, 2-up at `md+`). Stage-2 caps the array at 4, so the grid is at most 2 rows.

### 4. Preserve the empty-state branch

The Stage-1 empty-state stays — copy and CTA unchanged:

```tsx
if (view.current.length === 0) {
  return (
    <section className="space-y-4">
      <p className="text-base text-muted-foreground leading-7">
        You don&apos;t have any scheduled batches yet.
      </p>
      <Button asChild>
        <Link href="/create">
          Start a new batch
          <ArrowRight
            className="ml-1 size-4"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </Link>
      </Button>
    </section>
  );
}
```

### 5. Delete `past-batches-list.tsx`

After all edits, run:

```bash
grep -r "past-batches-list" src/
grep -r "PastBatchesList" src/
```

If both return zero hits, delete `src/components/schedule/past-batches-list.tsx`. If anything else still imports it, leave the file in place and flag the orphan in the task notes so a follow-up can clean it.

### 6. Page-level header rhythm

The route file `schedule/page.tsx` currently wraps everything in `max-w-3xl mx-auto space-y-12`. Stage-2 keeps that width and rhythm — the 2x2 grid sits comfortably inside `max-w-3xl` because each box is `~22rem` wide at `gap-6`. No edit to the route file expected unless TypeScript flags the `view.scheduledBatchCount` prop access.

## Acceptance Criteria

- [ ] `/schedule` renders boxes in a `grid-cols-1 md:grid-cols-2 gap-6` layout.
- [ ] Mobile (`<768px`) shows boxes stacked single-column.
- [ ] `md+` shows up to 2 boxes per row, max 4 total (so 1 or 2 rows).
- [ ] Past Batches disclosure is gone from the rendered page.
- [ ] `<PastBatchesList />` import is removed from `scheduled-page-client.tsx`.
- [ ] `past-batches-list.tsx` file is deleted, OR the orphan is documented if a non-zero grep result blocks deletion.
- [ ] `<CreateNextBatchCta scheduledBatchCount={view.scheduledBatchCount} />` mounts above the grid when the grid is non-empty.
- [ ] Empty-state copy `"You don't have any scheduled batches yet."` + `[Start a new batch →]` preserved exactly.
- [ ] Empty-state does NOT render `<CreateNextBatchCta />`.
- [ ] `[Cancel batch]` on a box still opens `<CancelBatchDialog />` with the correct batch data.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The 2x2 grid never exceeds 4 boxes because task-02 caps `view.current.length` at 4 (rolling-4 contract per D-S2-1). The grid does not need a `max-w` clamp on the inner container — `max-w-3xl` on the page wrapper handles it.
- DESIGN.md §8 pattern C (card-on-midnight grid) explicitly uses `gap-6 lg:gap-8`. Stage-2 sticks with `gap-6` because the page wrapper is `max-w-3xl` (narrow editorial column), not the dashboard's `max-w-6xl` where the `lg:gap-8` extra air earns its keep.
- The page-level `space-y-12` between header and grid stays — Fraunces `h1` needs breathing room above the CTA.
- If the route file needs to thread a new prop, keep the edit to the minimum necessary line. Do not refactor the route while you're here.

## Out of scope

- Building `<CreateNextBatchCta />` (task-12).
- Editing `<ScheduledBatchBox />` internals (tasks 13 + 14).
- Filtering / sorting controls.
- Pagination beyond the rolling-4 cap.
- Reintroducing past batches in any form — the rolling-4 IS the history per D-S2-1.
- Removing the `past: []` field from `ScheduledView` if it's still present. That's a task-02 concern; this task only stops consuming the field.
