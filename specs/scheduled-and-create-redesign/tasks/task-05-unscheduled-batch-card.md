# Task 05: UnscheduledBatchCard component

## Status
not started

## Wave
3

## Description

Build the presentational card component used by the Create Posts hub to surface each unscheduled batch (one card per `reviewing` or `cancelled` batch). State chip, theme, importantThing detail, per-network counts, total, and an `[Open →]` CTA linking to `/posts?batchId={id}`.

Pure server component. No client state. Consumes the row shape from task-01.

## Dependencies

**Depends on:** none (component scaffold; consumer wires it in task-06).
**Blocks:** task-06 (UnscheduledBatchList renders an array of these).
**Parallel with:** task-06 — both can be built in the same wave.

## Files to Modify

- `src/components/create/unscheduled-batch-card.tsx` (new).

## Implementation Steps

### 1. Type the props

```ts
import type { UnscheduledBatchCard as Data } from "@/lib/services/post-service";

type Props = { data: Data };
```

### 2. Render the card

```tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function UnscheduledBatchCard({ data }: Props) {
  const chip = STATE_CHIP[data.status];

  return (
    <article
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border p-6",
        "shadow-soft transition-all duration-300 ease-out",
        "hover:shadow-lift hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-fraunces text-xl tracking-tight font-medium">
            BATCH
          </span>
          <span aria-hidden className="text-muted-foreground">·</span>
          <Badge variant={chip.variant} className={chip.className}>
            {chip.label}
          </Badge>
        </div>
      </div>

      <p className="mt-3 text-base text-foreground leading-7">{data.theme}</p>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-1">
        {data.importantThing}
      </p>

      <div className="mt-5 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-muted-foreground">
          <NetworkCount label="FB" count={data.counts.facebook} />
          <span aria-hidden>·</span>
          <NetworkCount label="IG" count={data.counts.instagram} />
          <span aria-hidden>·</span>
          <NetworkCount label="LI" count={data.counts.linkedin} />
          <span aria-hidden>·</span>
          <span>
            <span className="text-foreground font-medium">{data.totalPosts}</span>{" "}
            posts
          </span>
        </div>

        <Button asChild size="sm">
          <Link href={`/posts?batchId=${data.id}`}>
            Open <ArrowRight className="ml-1 size-4" aria-hidden="true" />
          </Link>
        </Button>
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

const STATE_CHIP = {
  reviewing: {
    label: "IN REVIEW",
    variant: "default" as const,
    className: "",  // default Badge = champagne tint per DESIGN.md §9
  },
  cancelled: {
    label: "CANCELLED — re-schedule",
    variant: "outline" as const,
    className:
      "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
} as const;
```

### 3. Use Lucide stroke width 1.5

`ArrowRight` already inherits the project default. If a Lucide `stroke` prop isn't already set globally, add `strokeWidth={1.5}` to match DESIGN.md §10.

### 4. Voice / copy check

- `BATCH · IN REVIEW` / `BATCH · CANCELLED — re-schedule` — uppercase per the brief's mock. Matches the Scheduled boxes for consistency.
- `Open` (with trailing arrow) — single confident verb. No exclamation.

### 5. Accessibility

- `<article>` for semantic grouping.
- Decorative middle dots and arrow get `aria-hidden`.
- The CTA is a Link inside a Button (`asChild`) — keyboard-focusable, visible focus ring inherited from Button.

## Acceptance Criteria

- [ ] Renders title row: "BATCH ·" + state chip.
- [ ] Chip variant matches `STATE_CHIP[data.status]`.
- [ ] Theme renders as a single line of base body text.
- [ ] `importantThing` renders as muted-foreground caption, `line-clamp-1`.
- [ ] Network counts row shows FB/IG/LI counts + totalPosts.
- [ ] `[Open →]` Button is a Next.js `Link` to `/posts?batchId=${data.id}`.
- [ ] Card uses `bg-card`, `rounded-2xl`, `p-6`, `shadow-soft`, hover `shadow-lift`.
- [ ] All Lucide icons render at stroke-width 1.5 per DESIGN.md §10.
- [ ] No exclamation points. No emojis.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The card is a **server component** (no `"use client"` directive). It has no state and no event handlers. The Link inside Button works fine in server components.
- The cancelled-state chip uses amber (warning) per DESIGN.md §3 — it sits in the gold family rather than the destructive coral, which would imply error.
- The state chip wraps the badge so the title row stays a flex item with the badge inline.

## Out of scope

- Click-outside-the-button card-level navigation. The whole card is *not* clickable — only the `[Open →]` button is. This avoids accidental navigation when users want to read the theme.
- Per-batch thumbnail / image preview. Add when an image library exists.
- Drag-to-reorder. Batches are read-only here.
- Inline rename / theme edit. Edits happen in the wizard.
