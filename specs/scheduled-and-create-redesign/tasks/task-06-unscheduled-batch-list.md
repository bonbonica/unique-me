# Task 06: UnscheduledBatchList component

## Status
not started

## Wave
3

## Description

The list wrapper that sits above the existing `<GenerateForm />` / `<QuotaGatedScreen />` on the Create Posts hub. Renders the two top buttons (`[Start new batch]`, `[See scheduled posts →]`) and stacks any unscheduled-batch cards.

Server component for the cards; client wrapper for the "Start new batch" toggle interaction.

## Dependencies

**Depends on:** task-01 (consumes `UnscheduledBatchCard[]`), task-05 (renders `<UnscheduledBatchCard />`).
**Blocks:** task-07 (Create page mounts this list).

## Files to Modify

- `src/components/create/unscheduled-batch-list.tsx` (new) — the server orchestrator.
- `src/components/create/unscheduled-batch-list-controls.tsx` (new) — small client wrapper that owns the form-toggle state (lifted up from the page via a slot).

## Implementation Steps

### 1. Top-buttons row + cards stack

```tsx
// unscheduled-batch-list.tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnscheduledBatchCard } from "./unscheduled-batch-card";
import type { UnscheduledBatchCard as CardData } from "@/lib/services/post-service";

type Props = {
  cards: CardData[];
  startNewBatchSlot?: React.ReactNode;
  hasCapacity: boolean;
  capacityTooltip?: string;
};

export function UnscheduledBatchList({
  cards,
  startNewBatchSlot,
  hasCapacity,
  capacityTooltip,
}: Props) {
  if (cards.length === 0 && !startNewBatchSlot) return null;

  return (
    <section className="space-y-6" aria-label="Unscheduled batches">
      <div className="flex flex-wrap items-center gap-3">
        {startNewBatchSlot ?? (
          <Button
            disabled={!hasCapacity}
            title={!hasCapacity ? capacityTooltip : undefined}
          >
            Start new batch
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/schedule">
            See scheduled posts <ArrowRight className="ml-1 size-4" aria-hidden />
          </Link>
        </Button>
      </div>

      {cards.length > 0 && (
        <div className="space-y-4">
          {cards.map((card) => (
            <UnscheduledBatchCard key={card.id} data={card} />
          ))}
        </div>
      )}
    </section>
  );
}
```

### 2. The `startNewBatchSlot` pattern

The Create page (task-07) owns the actual form-expand interaction (because the form itself is below the list, sibling-not-child). It passes a custom `[Start new batch]` button into this slot — that button reaches over the list and toggles the form sibling.

When the page is in a state where capacity is exhausted, it passes `hasCapacity={false}` and `capacityTooltip="You've used all batches this period."`. The component renders a disabled default button instead of the slot.

When the page is the fresh-state (zero cards, form expanded by default), the page can either pass no slot (default button is rendered but cards.length === 0 hides the whole section) or omit the list entirely. Task-07 decides which.

### 3. Empty-state behavior

`UnscheduledBatchList` early-returns `null` when there are no cards AND no slot. This means: on a fresh trial / Pro user with zero batches and an expanded form, the list section is invisible — the form takes the whole frame.

When the user generates a first batch and is in `reviewing`, the list reappears with one card.

### 4. "See scheduled posts" link

Always rendered, even in the zero-cards case (if the section renders at all). Outline variant per DESIGN.md §9 button matrix.

## Acceptance Criteria

- [ ] `<UnscheduledBatchList cards={...} hasCapacity={...} />` renders the top-buttons row + stacked cards.
- [ ] Renders `null` when `cards.length === 0 && !startNewBatchSlot`.
- [ ] Default `[Start new batch]` button is disabled when `hasCapacity={false}`.
- [ ] Capacity tooltip appears on hover/focus when provided.
- [ ] `[See scheduled posts →]` is an outline button linking to `/schedule`.
- [ ] Cards stack with `space-y-4` (DESIGN.md §5).
- [ ] Section uses `aria-label="Unscheduled batches"` for screen-reader context.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The `startNewBatchSlot` is intentionally a render slot rather than a callback. The page owns the form-toggle state; this component stays purely presentational.
- Tooltip implementation: shadcn's `<Tooltip>` if already in the project; otherwise a native `title` attribute is acceptable for Stage-1 (the disabled button doesn't need a rich tooltip — it's a secondary affordance to the gated screen below).
- The `flex-wrap` on the top-buttons row handles mobile gracefully — buttons stack instead of getting clipped at narrow viewports.

## Out of scope

- Search / filter across batches. Cap is 4 unscheduled — not enough to need it.
- Sort controls. Default `createdAt DESC` from task-01 is correct.
- Bulk select / delete. Per-batch actions are inside the wizard.
- A drawer-style overlay for the form. Form is sibling-below, not overlay.
