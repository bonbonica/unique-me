# Task 12: <CreateNextBatchCta /> component

## Status
not started

## Wave
4

## Description

Build the capacity-aware CTA that sits above the 2x2 grid on `/schedule` (D-S2-13, spec §6.6). Renders `[Create next batch — {scheduledBatchCount}/4]`. When `scheduledBatchCount === 4`, the button is disabled and a `<Tooltip>` reads `"Schedule a new batch by cancelling or finishing one."`. When enabled, the button links to `/create`. Uses `<Button variant="default" size="lg">` per DESIGN.md §9 — the primary champagne-pill CTA. Full width on mobile, `max-w-xs` on desktop.

The component is built and exported here. The page-level mount (importing it into `scheduled-page-client.tsx` and passing `scheduledBatchCount`) is task-11's responsibility — this split keeps each task to a single file.

## Dependencies

**Depends on:** task-02 (snapshot supplies `scheduledBatchCount` via `ScheduledView`).
**Blocks:** task-11 (page imports this component).
**Parallel with:** task-11, task-13, task-14.

## Files to Create

- `src/components/schedule/create-next-batch-cta.tsx` (new).

## Implementation Steps

### 1. Type the props

```ts
type Props = {
  scheduledBatchCount: number;
};
```

No other props — the component derives label, disabled state, and tooltip from the count alone.

### 2. Component skeleton

```tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const CAP = 4;

/**
 * Capacity-aware CTA that sits above the 2x2 grid on `/schedule` (D-S2-13).
 *
 * Label: `Create next batch — {n}/4`
 * Enabled when n < 4 → links to `/create`.
 * Disabled when n === 4 → tooltip "Schedule a new batch by cancelling or
 * finishing one." (the only way to free a slot is finishing or cancelling
 * one of the existing 4).
 *
 * Uses DESIGN.md §9 primary button: `variant="default"`, `size="lg"`,
 * rounded-full champagne pill. Full width on mobile, `max-w-xs` on `md+`.
 */
export function CreateNextBatchCta({ scheduledBatchCount }: Props) {
  const atCap = scheduledBatchCount >= CAP;
  const label = `Create next batch — ${scheduledBatchCount}/${CAP}`;

  if (atCap) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Disabled button is wrapped in a span so the tooltip still
                receives pointer events — disabled <button>s don't fire them. */}
            <span className="inline-block w-full md:max-w-xs">
              <Button
                variant="default"
                size="lg"
                disabled
                aria-disabled="true"
                className="w-full"
              >
                {label}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Schedule a new batch by cancelling or finishing one.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      asChild
      variant="default"
      size="lg"
      className="w-full md:max-w-xs"
    >
      <Link href="/create">{label}</Link>
    </Button>
  );
}
```

### 3. Disabled-button + tooltip pattern

Disabled `<button>` elements swallow pointer events, which breaks shadcn's `<Tooltip>` (it relies on `pointermove` on the trigger). Wrapping the disabled button in a `<span>` and forwarding the trigger via `asChild` is the standard workaround — keeps the disabled visual state AND lets the tooltip fire.

`aria-disabled="true"` is redundant with the `disabled` prop for native buttons but kept for screen-reader clarity when the wrapper span confuses some readers.

### 4. Width behavior

`w-full md:max-w-xs` per spec §6.6. On mobile, the CTA spans the page-content width (`max-w-3xl` minus gutters). On `md+`, it caps at `max-w-xs` (20rem) — narrow enough to read as a single deliberate action, not a banner.

`max-w-xs` on the disabled branch is applied to the wrapper `<span>`, not the button, so the tooltip trigger boundary matches the visible button width.

### 5. Tooltip copy

Exact string per spec D-S2-13:

```
Schedule a new batch by cancelling or finishing one.
```

No exclamation point (DESIGN.md §14 brand voice). No "you" — neutral.

### 6. Client vs server

The component is **client** (`"use client"`) because:
- `<Tooltip>` from shadcn requires client-side state (open/close, pointer tracking).
- `<Button asChild>` with a `<Link>` works in either, but the tooltip forces client.

The page (`schedule/page.tsx`) stays a server component — this client island is small and self-contained.

## Acceptance Criteria

- [ ] File `src/components/schedule/create-next-batch-cta.tsx` exists and exports `CreateNextBatchCta` (named export).
- [ ] Props: single `scheduledBatchCount: number` prop. No others.
- [ ] Renders label `"Create next batch — {n}/4"` with the live count substituted.
- [ ] At `scheduledBatchCount < 4`, button is enabled, wraps a `<Link href="/create">`, and uses `Button variant="default" size="lg"`.
- [ ] At `scheduledBatchCount === 4` (or higher, defensively), button is disabled AND a `<Tooltip>` reads exactly `"Schedule a new batch by cancelling or finishing one."`.
- [ ] Disabled state uses the `<span>` wrapper pattern so the tooltip fires on hover/focus.
- [ ] Width: `w-full` on mobile, `max-w-xs` on `md+`.
- [ ] No nav happens when disabled (the disabled button blocks clicks, AND there's no `<Link>` in the disabled branch).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- Mount-site decision: task-11 imports and renders this component. This task only creates the file. The split avoids two tasks editing `scheduled-page-client.tsx` and keeps task-12's surface area small.
- The label spec uses an em-dash-style separator `— ` (U+2014 + space). Keep the em-dash; do NOT substitute a hyphen or en-dash. DESIGN.md §14 leans on em-dashes for the refined-typography feel.
- DESIGN.md §9 primary buttons get an optional `glow-champagne` shadow on focal CTAs. This CTA is NOT focal in the usual sense (the grid below is), so omit `glow-champagne` here — one glow per viewport per DESIGN.md.
- If shadcn's `<Tooltip>` is not yet installed in the project, run `pnpm dlx shadcn@latest add tooltip` before this task starts. Most likely already present from earlier waves.
- The CTA is hidden from screen readers as a redundant duplicate when the empty-state CTA is on screen — task-11 handles this by not mounting `<CreateNextBatchCta />` in the empty branch. No `aria-hidden` needed here.

## Out of scope

- Mounting the CTA on `/schedule` (task-11).
- The 7-day strip inside batch boxes (task-13).
- The `{N} posts` link inside batch boxes (task-14).
- Surfacing the pill copy `{N} batches left` — that lives in `<QuotaCountdownPill />` (task-10), not here.
- An alternate "cap raised by upgrade" affordance — Stage-2's cap is fixed at 4 for Pro.
