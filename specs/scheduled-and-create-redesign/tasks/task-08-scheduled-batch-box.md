# Task 08: ScheduledBatchBox component

## Status
not started

## Wave
4

## Description

The color-coded box that renders on `/schedule` for each `scheduling` batch. Supports three `derivedState` variants — `upcoming` (blue, the only one Stage-1 actually renders from data), `currently_posting` (emerald, dormant Stage-1, lights up when Phase 4 ships), and the dormant `currently_posting` variant must look correct against DESIGN.md tokens so Phase 4 doesn't touch this file.

The box surfaces theme + detail + per-network counts + total + `[Cancel batch]` button.

## Dependencies

**Depends on:** task-02 (consumes `BatchBoxData`).
**Blocks:** task-11 (page renders array of these), task-13 (verification smokes the dormant variant).
**Parallel with:** task-09, task-10.

## Files to Modify

- `src/components/schedule/scheduled-batch-box.tsx` (new).

## Implementation Steps

### 1. Type the props

```ts
import type { BatchBoxData } from "@/lib/services/post-service";

type Props = {
  data: BatchBoxData;
  onCancelClick: () => void;   // task-11 passes a handler that opens the dialog
};
```

### 2. Header strip + body layout

```tsx
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScheduledBatchBox({ data, onCancelClick }: Props) {
  const tone = STATE_TONE[data.derivedState];
  const label = formatLabel(data.ordinal, tone.copyLabel);

  return (
    <article
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border",
        "shadow-soft overflow-hidden",
      )}
      aria-label={`Batch ${data.ordinal ?? ""}, ${tone.copyLabel}`}
    >
      <header
        className={cn(
          "px-6 py-3 border-b border-border text-xs font-medium tracking-wider uppercase",
          tone.headerStrip,
        )}
      >
        {label}
      </header>

      <div className="p-6 space-y-5">
        <div>
          <p className="text-base text-foreground leading-7">{data.theme}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.importantThing}
          </p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3 text-muted-foreground">
            <NetworkCount label="FB" count={data.counts.facebook} />
            <span aria-hidden>·</span>
            <NetworkCount label="IG" count={data.counts.instagram} />
            <span aria-hidden>·</span>
            <NetworkCount label="LI" count={data.counts.linkedin} />
          </div>
          <span className="text-foreground font-medium">
            {data.totalPosts} posts
          </span>
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancelClick}
          >
            Cancel batch
          </Button>
        </div>
      </div>
    </article>
  );
}

function NetworkCount({ label, count }: { label: string; count: number }) {
  return (
    <span>
      {label} <span className="text-foreground font-medium">{count}</span>
    </span>
  );
}

function formatLabel(ordinal: number | null, stateLabel: string): string {
  return ordinal !== null
    ? `BATCH ${ordinal} · ${stateLabel}`
    : `BATCH · ${stateLabel}`;
}

const STATE_TONE = {
  upcoming: {
    copyLabel: "UPCOMING",
    headerStrip:
      "bg-primary/15 text-primary border-b-primary/30",
  },
  currently_posting: {
    copyLabel: "CURRENTLY POSTING",
    headerStrip:
      "bg-emerald-500/15 text-emerald-300 border-b-emerald-500/30",
  },
} as const;
```

### 3. Dormant variant rules

The `currently_posting` arm is in the `STATE_TONE` map and reachable via the `data.derivedState === "currently_posting"` path. In Stage-1, the data layer (task-02) never produces this value — so this branch is unreachable from real data, but the component supports it.

Verification task-13 will render this variant via an ad-hoc dev route or manual prop injection to confirm the emerald palette reads correctly against DESIGN.md tokens.

### 4. Client vs server

The Cancel button is interactive (`onClick`). That makes this component **client** (`"use client"`). The cancel handler is passed in from the page — task-11 owns the dialog state.

### 5. Accessibility

- `<article>` wraps each box.
- `aria-label` summarises the box for screen readers.
- Header strip is decorative-styled but is real text content; no `aria-hidden`.
- Decorative middle dots get `aria-hidden`.

## Acceptance Criteria

- [ ] Renders header strip + body for both variants (`upcoming` blue, `currently_posting` emerald).
- [ ] Pro batch with `ordinal=1` renders `"BATCH 1 · UPCOMING"`.
- [ ] Trial/Starter batch with `ordinal=null` renders `"BATCH · UPCOMING"`.
- [ ] `derivedState === "currently_posting"` renders the emerald variant; data layer never produces this in Stage-1, but the variant renders correctly when forced.
- [ ] Theme + importantThing render with correct typography (base body + muted caption).
- [ ] Network counts row + total render correctly.
- [ ] `[Cancel batch]` button fires `onCancelClick`.
- [ ] All Lucide stroke widths = 1.5 per DESIGN.md §10 (no Lucide icons in this component today, but be ready if one is added).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- DESIGN.md §3 says status emerald uses `text-emerald-300 / bg-emerald-500/20`. This component uses `/15` for the strip background to keep it subtler against the box's `bg-card` — adjust to `/20` if the visual review (task-13) calls for it.
- Cancel button is `variant="outline"` rather than `"destructive"` — DESIGN.md §9 reserves destructive for delete actions. Cancel is reversible (the batch comes back to Create Posts), so destructive styling overstates the severity. The dialog (task-10) is where the user confirms.
- The "no `finished`/grey variant in the box component" is intentional — finished batches render as compact rows via `<PastBatchesList />` (task-09), not as full boxes.

## Out of scope

- Per-day timeline preview inside the box. Phase 4 calendar concern.
- Drag-to-reorder boxes.
- Re-open / un-cancel buttons.
- Inline edit of theme. Edits happen in the wizard at `/posts`.
- Loading skeleton during state transitions.
