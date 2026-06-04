# Task 13: <SevenDayStrip /> component + mount in batch box

## Status
not started

## Wave
4

## Description

Build the 7-cell calendar strip that lives inside each `<ScheduledBatchBox />` between the header title strip and the network-counts row (D-S2-12, spec §6.7 + §6.8). Each cell shows a day label (Mon, Tue, ...) and a status glyph: ✓ (champagne) for scheduled, ✗ (destructive) for cancelled, emerald dot for the Phase-7-dormant `posted` value. Always 7 cells — slots persist after cancellation (no compaction).

The strip is purely presentational — no clicks, no state. Data comes from `BatchBoxData.days` (added by task-02 to the service-layer return shape).

This task also performs the single insertion into `scheduled-batch-box.tsx` that adds the `<SevenDayStrip />` between the header `<header>` and the existing counts row. The insertion point is well-defined (between the header's closing tag and the start of the `.p-6.space-y-5` body block); task-14's edit to the same file is downstream of this insertion.

## Dependencies

**Depends on:** task-02 (`BatchBoxData.days` field shipped).
**Blocks:** task-14 (task-14 edits the counts row INSIDE `scheduled-batch-box.tsx` — sequencing task-13 first means task-14 doesn't have to merge around the strip insertion).
**Parallel with:** task-11, task-12.

**PARALLELISM NOTE:** this task and task-14 share `scheduled-batch-box.tsx`. They MUST be implemented sequentially or by the same agent, NOT by two parallel agents on the same branch. Sequence: task-13 first (inserts strip + creates new file), task-14 second (mutates an existing line in the counts row). Marked `Blocks: task-14` accordingly.

## Files to Create

- `src/components/schedule/seven-day-strip.tsx` (new).

## Files to Modify

- `src/components/schedule/scheduled-batch-box.tsx` (insert `<SevenDayStrip days={data.days} />` between the header strip and the body `<div className="p-6 space-y-5">`).

## Implementation Steps

### 1. Type the props

```ts
export type SevenDayStripDay = {
  label: string;                       // "Mon", "Tue", ... — short weekday
  date: Date;                          // exact scheduled date (used for tooltip / aria)
  status: "scheduled" | "cancelled" | "posted";
};

type Props = {
  days: SevenDayStripDay[];            // length exactly 7
};
```

Exporting the row type so task-02 can import it from here (avoiding circular type imports through `post-service.ts`). If task-02 has already defined the type, keep this export as a re-export and match the shape.

### 2. Build the strip

```tsx
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 7-cell calendar strip rendered inside `<ScheduledBatchBox />` between the
 * header title strip and the network-counts row (D-S2-12).
 *
 *   Mon  Tue  Wed  Thu  Fri  Sat  Sun
 *    ✓    ✓    ✗    ✓    ✓    ✓    ✓
 *
 * Cells are fixed: 7 slots always, derived from posts.postOrder 1..7.
 * Cancelled posts leave their slot in place (✗) — no compaction.
 *
 * Status glyphs:
 *   - scheduled → champagne ✓ (text-primary)
 *   - cancelled → destructive ✗ (text-destructive)
 *   - posted    → emerald dot (Phase-7-dormant; Stage-2 never produces)
 *
 * Purely presentational. No clicks, no state.
 */
export function SevenDayStrip({ days }: Props) {
  return (
    <div
      className="grid grid-cols-7 gap-3"
      role="list"
      aria-label="7-day post schedule"
    >
      {days.map((day, idx) => (
        <DayCell key={idx} day={day} />
      ))}
    </div>
  );
}

function DayCell({ day }: { day: SevenDayStripDay }) {
  const fullDate = day.date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      role="listitem"
      className="flex flex-col items-center gap-1 text-center"
      aria-label={`${fullDate}: ${day.status}`}
    >
      <span className="text-xs text-muted-foreground tracking-wide uppercase">
        {day.label}
      </span>
      <StatusGlyph status={day.status} />
    </div>
  );
}

function StatusGlyph({ status }: { status: SevenDayStripDay["status"] }) {
  if (status === "scheduled") {
    return (
      <Check
        className="size-4 text-primary"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }

  if (status === "cancelled") {
    return (
      <X
        className="size-4 text-destructive"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }

  // posted — Phase-7 dormant. Emerald dot.
  return (
    <span
      className={cn(
        "block size-2 rounded-full bg-emerald-400/80",
      )}
      aria-hidden="true"
    />
  );
}
```

### 3. Mount inside `<ScheduledBatchBox />`

In `src/components/schedule/scheduled-batch-box.tsx`, add the import at the top:

```ts
import { SevenDayStrip } from "./seven-day-strip";
```

Insert the strip between the header `<header>` block and the body `<div className="p-6 space-y-5">`. Concretely, the box body becomes:

```tsx
<header className={cn(...)}>...</header>

<div className="px-6 pt-5 pb-1">
  <SevenDayStrip days={data.days} />
</div>

<div className="p-6 pt-2 space-y-5">
  {/* existing theme / counts / cancel block */}
</div>
```

The strip gets its own `px-6 pt-5 pb-1` wrapper so it sits flush with the box's horizontal padding and has breathing room above and a slim gap below the theme block. Reduce the existing body `p-6` to `p-6 pt-2` so the visual rhythm stays — the strip absorbs the top padding.

### 4. Lucide stroke width

`strokeWidth={1.5}` on every Lucide icon per DESIGN.md §10. The existing batch box has no Lucide icons today; this task introduces `Check` and `X` and both MUST set the stroke explicitly.

### 5. Accessibility

- The strip is a list of 7 day-status pairs. Use `role="list"` + `role="listitem"` rather than the default semantics so screen readers announce it as a sequence.
- Each cell's `aria-label` includes the full date + status (`"Monday, Jun 03: scheduled"`).
- The decorative glyphs are `aria-hidden="true"` — the status is already in the `aria-label`.

### 6. Empty / partial data

If `days.length !== 7` (data bug in `BatchBoxData`), the grid still renders whatever's there. Stage-2 contract is exactly 7 — task-02 enforces this — so no defensive padding in the component. If you see < 7 in dev, fix it at the data layer, not here.

## Acceptance Criteria

- [ ] File `src/components/schedule/seven-day-strip.tsx` exists and exports `SevenDayStrip` (named).
- [ ] Exports `SevenDayStripDay` row type for downstream type import.
- [ ] Renders a `grid grid-cols-7 gap-3` of 7 cells.
- [ ] Each cell shows the short weekday label (Mon, Tue, ...) above the status glyph.
- [ ] `scheduled` → champagne `<Check>` icon (`text-primary`).
- [ ] `cancelled` → destructive `<X>` icon (`text-destructive`).
- [ ] `posted` → emerald `bg-emerald-400/80` dot (Phase-7 dormant; never seen from Stage-2 data).
- [ ] All Lucide icons set `strokeWidth={1.5}` per DESIGN.md §10.
- [ ] Each cell has an `aria-label` with the full date + status.
- [ ] No `onClick`, no state — purely presentational.
- [ ] `<ScheduledBatchBox />` renders the strip between the header strip and the theme/counts block, with `px-6 pt-5 pb-1` wrapper.
- [ ] The existing theme + counts + cancel block continues to render unchanged.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- DESIGN.md §3 status emerald is `text-emerald-300 / bg-emerald-500/20`. The dot uses `bg-emerald-400/80` instead — at `size-2` the `/20` token reads as nearly invisible, and `400/80` is the closest in-system value that registers as a confident dot without competing with the champagne checkmarks. If task-13's design review flags this, swap to `bg-emerald-300` (no opacity modifier).
- The strip respects the box's container padding (`px-6`) — keeping it aligned with the theme block below.
- `tracking-wide uppercase` on the day labels matches the header strip's typography family (small-caps muted captions) per DESIGN.md §4.
- DESIGN.md §9 doesn't specify a strip-row component; this composition is built from primitives. The grid is `grid-cols-7 gap-3` to keep glyphs centered under their labels.
- Stage-2 data layer (task-02) produces only `scheduled` and `cancelled`. The `posted` branch is dormant — included so Phase 7 doesn't have to touch this file.

## Out of scope

- Clicking a cell to navigate to the post (Stage-2 routes through `{N} posts` link instead — task-14).
- Hover preview of the post body. Detail page (`/schedule/[batchId]`, task-15) covers per-post detail.
- A vertical / month variant. 7-day horizontal only.
- Animating glyph state transitions when a user cancels a post — no animation contract in Stage-2.
- Tooltip on hover showing the scheduled time. The `aria-label` covers the screen-reader case; visual tooltip can be added in a follow-up if user testing calls for it.
