# Task 14: <ScheduledBatchBox /> — `{N} posts` becomes a link

## Status
not started

## Wave
4

## Description

Per D-S2-14 (spec §6.7), the `{N} posts` text in the network-counts row of `<ScheduledBatchBox />` becomes a `<Link href="/schedule/${data.id}">` with `hover:underline text-foreground font-medium` styling. The link is the entry point to the new `/schedule/[batchId]` detail page (built in task-15, Wave 5). Stage-2 ships the link surface in Wave 4 so the detail page has a live caller from day 1 of Wave 5.

This is a single-line change to one line in `scheduled-batch-box.tsx` — the `<span className="text-foreground font-medium">{data.totalPosts} posts</span>` node.

## Dependencies

**Depends on:** task-13 (same file edits — task-13 inserts the `<SevenDayStrip />` BETWEEN the header and the counts row; task-14 mutates the counts row itself. Sequencing task-13 first means task-14's diff stays clean and doesn't need to merge around the strip insertion).
**Blocks:** none within Wave 4. Task-15 (Wave 5, detail page) is the natural downstream consumer of the link target, but does NOT block on task-14 — the detail route can be hit directly by URL even before the link surfaces.
**Parallel with:** task-11, task-12.

**PARALLELISM NOTE:** this task and task-13 share `scheduled-batch-box.tsx`. They MUST be implemented sequentially or by the same agent, NOT by two parallel agents on the same branch. Recommended sequence: task-13 first (header → counts insertion of `<SevenDayStrip />`), task-14 second (counts row mutation). Marked `Depends on: task-13` accordingly.

## Files to Modify

- `src/components/schedule/scheduled-batch-box.tsx` (single-line edit to the totalPosts span in the network-counts row).

## Implementation Steps

### 1. Add the `Link` import

At the top of `scheduled-batch-box.tsx`, add:

```ts
import Link from "next/link";
```

Alphabetize alongside the existing `import { Button }` — `Link` comes before `Button` in the alphabetical sort, but the project's existing convention is to keep `next/*` imports above `@/*` imports. Follow the surrounding style.

### 2. Replace the `{N} posts` span with a Link

Current (post-task-13 state):

```tsx
<span className="text-foreground font-medium">
  {data.totalPosts} posts
</span>
```

Replace with:

```tsx
<Link
  href={`/schedule/${data.id}`}
  className="text-foreground font-medium hover:underline underline-offset-4 decoration-primary/60"
>
  {data.totalPosts} posts
</Link>
```

Class breakdown:
- `text-foreground font-medium` — preserves the existing visual weight.
- `hover:underline` — D-S2-14's explicit affordance.
- `underline-offset-4` — DESIGN.md §9 link convention (4px offset matches the `link` button variant).
- `decoration-primary/60` — champagne underline at 60% opacity. Subtle, in-brand.

### 3. No other changes

The rest of the file — header strip, theme block, day strip (from task-13), network counts (FB/IG/LI), cancel button — stays exactly as-is. This task touches exactly one element.

### 4. Accessibility

Native `<Link>` (Next.js `next/link`) renders as a real `<a>` — keyboard-focusable, screen-reader-announced as a link. No additional `aria-*` needed. The link text "5 posts" (or whatever the count is) is descriptive enough on its own.

The surrounding `<article aria-label="Batch 1, upcoming">` from the batch box wrapper provides the parent-context for screen readers, so the link doesn't need its own aria-label disambiguation.

### 5. Verify the route exists or is planned

`/schedule/[batchId]` is built in task-15 (Wave 5). Until task-15 lands, clicking the link in dev will hit Next.js's default 404. That's acceptable — the link surface is correct and Wave 5 lights up the destination. Note this in the verification step.

## Acceptance Criteria

- [ ] `next/link` imported at the top of `scheduled-batch-box.tsx`.
- [ ] `{N} posts` text in the network-counts row is wrapped in a `<Link>` with `href={`/schedule/${data.id}`}`.
- [ ] Link className includes `hover:underline`, `text-foreground`, `font-medium`, and a champagne underline decoration.
- [ ] All other content in `<ScheduledBatchBox />` is unchanged (header, theme, day strip, network counts, cancel button).
- [ ] Hover state on the link visibly underlines the text.
- [ ] Keyboard focus on the link shows the standard champagne `focus-visible:ring` from the global focus contract.
- [ ] Clicking the link navigates to `/schedule/{batchId}` (renders 404 until task-15 lands — expected).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The spec-quoted className is `hover:underline text-foreground font-medium`. This task expands that to include `underline-offset-4 decoration-primary/60` for DESIGN.md compliance — the spec's class list is a minimum, not a maximum. If a future redesign wants a different underline color, the change is one className token.
- The `decoration-primary/60` underline matches the `link` button variant's `text-primary underline-offset-4 hover:underline` pattern from DESIGN.md §9, while keeping the resting text color ivory (`text-foreground`) so the link doesn't compete with the cancel button or the champagne header strip.
- Stage-2 does NOT make the entire batch box a link. The box's primary affordance is `[Cancel batch]`; the `{N} posts` link is the secondary navigation to the detail page. Don't expand the click target — the spec is explicit that only this text becomes a link.
- After task-15 ships the detail page, task-18 (Wave 6 audit) will smoke-test this navigation path end-to-end.

## Out of scope

- Building the `/schedule/[batchId]` route (task-15, Wave 5).
- The 7-day strip (task-13).
- Making the whole box clickable.
- Changing the cancel button styling.
- Adding a chevron / arrow icon next to `{N} posts` — text + hover underline is the entire affordance per D-S2-14.
- Refactoring the `NetworkCount` helper or the counts row layout.
