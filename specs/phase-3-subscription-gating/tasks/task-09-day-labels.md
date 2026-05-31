# Task 09: DayLabel Component + Render Sites

## Status
not started

## Wave
3

## Description

A `<DayLabel postOrder batchCreatedAt />` client component that renders "Day N · Weekday" based on the batch's creation timestamp + the post's order, computed in the user's browser timezone. Render on every wizard step card, summary card, and locked-summary card.

## Dependencies

**Depends on:** none (works against existing Phase 2 card structures)
**Blocks:** none
**Context from dependencies:** N/A.

## Files to Modify

- `src/components/posts/day-label.tsx` (new) — client component
- `src/components/posts/wizard-step.tsx` (modified) — render `<DayLabel />` per card
- `src/components/posts/wizard-summary.tsx` (modified) — render `<DayLabel />` per card
- `src/components/posts/locked-summary.tsx` (modified) — render `<DayLabel />` per card

## Implementation Steps

### 1. `<DayLabel />` (client component)

```tsx
"use client";

import { useMemo } from "react";

type Props = {
  postOrder: number;          // 1..7
  batchCreatedAt: Date | string; // ISO string from server props is fine
};

export function DayLabel({ postOrder, batchCreatedAt }: Props) {
  const label = useMemo(() => {
    const base = batchCreatedAt instanceof Date
      ? batchCreatedAt
      : new Date(batchCreatedAt);
    const dayDate = new Date(base.getTime() + (postOrder - 1) * 86_400_000);
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })
      .format(dayDate);
    return `Day ${postOrder} · ${weekday}`;
  }, [postOrder, batchCreatedAt]);

  return (
    <span className="text-xs text-muted-foreground font-medium">
      {label}
    </span>
  );
}
```

### 2. Wizard step card

Add `<DayLabel postOrder={post.postOrder} batchCreatedAt={batch.createdAt} />` to the existing per-card header row, alongside the `Post N / 7` badge and the network icon. Same row, small text, muted color.

### 3. Wizard summary card

Same insertion — the summary cards (Phase 2 redesign) already have a header row with the network badge. Add the day label adjacent to it.

### 4. Locked summary card

The locked summary already has a "Day N — scheduled time pending" line (Phase 2). Replace `Day N` with the full `<DayLabel />` output (or just the weekday-aware version) so the day name appears even before scheduling lands.

### 5. SSR mismatch handling

- The component is client-only (`"use client"`).
- The wrapping server component can still pass `batchCreatedAt` as a `Date` object (Next.js serializes it).
- One-frame timezone flash is acceptable (per spec § 9 risks). Don't try to read `Intl.DateTimeFormat` on the server — it'll use the server's timezone (UTC), which is wrong.

### 6. Timezone source of truth

`undefined` as the first arg to `Intl.DateTimeFormat` lets the browser use its detected timezone. Don't accept a `timezone` prop or read it from the user — the browser is authoritative for Phase 3.

## Acceptance Criteria

- [ ] `<DayLabel />` renders on every wizard step card, every summary card, every locked-summary card.
- [ ] Label format matches "Day N · Weekday" (e.g., "Day 1 · Wed").
- [ ] Day 1 corresponds to the weekday `batch.createdAt` falls on in the user's browser timezone.
- [ ] Day 7's weekday is correctly computed (no off-by-one on DST boundaries — `Intl.DateTimeFormat` handles this).
- [ ] No server-rendered timezone in the output (verify: view-source on `/posts` shows the label rendered client-side, possibly after a brief loading state).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- We use `86_400_000` ms instead of `addDays`-style helpers because we don't want to introduce a date-fns dependency for one calculation. The simple math is fine — DST drift across 6 days is at most 1 hour, which doesn't change the weekday.
- "Day 1 · Wed" beats "Wed · Day 1" because users scan-read the day number first (it answers "how far through the week am I?"). Keep this order.
- Don't render the full date ("Day 1 · Wed, May 30"). The week-relative framing is the design intent — users care about "which day of my week is this", not the absolute date.
