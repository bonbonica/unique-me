# Task 09: PastBatchesList component

## Status
not started

## Wave
4

## Description

A closed-by-default collapsible disclosure showing finished (`completed`) batches in the current period as compact rows. Empty-state copy lives inside the disclosure body, so users see `"No finished batches in this period."` rather than a confusing empty disclosure.

In Stage-1 production this list will always be empty (no posting-service to mark batches `completed`). The component ships with the empty-state path tested; when Phase 7 lands, completed batches start populating without further changes here.

## Dependencies

**Depends on:** task-02 (consumes `PastBatchRow[]`).
**Blocks:** task-11.
**Parallel with:** task-08, task-10.

## Files to Modify

- `src/components/schedule/past-batches-list.tsx` (new).

## Implementation Steps

### 1. Type the props

```ts
import type { PastBatchRow } from "@/lib/services/post-service";

type Props = { rows: PastBatchRow[] };
```

### 2. Use a native `<details>` / `<summary>` disclosure

Lightweight, accessible by default, doesn't need a client component. Closed by default — no `open` attribute.

```tsx
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function PastBatchesList({ rows }: Props) {
  return (
    <details className="group">
      <summary
        className={cn(
          "flex items-center gap-2 cursor-pointer list-none",
          "text-sm font-medium text-foreground",
          "py-3 select-none",
        )}
      >
        <ChevronRight
          className="size-4 transition-transform group-open:rotate-90"
          aria-hidden
          strokeWidth={1.5}
        />
        <span>Past batches</span>
        <span className="text-muted-foreground">({rows.length})</span>
      </summary>

      <div className="pt-2 pb-1 pl-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">
            No finished batches in this period.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <PastBatchRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function PastBatchRowItem({ row }: { row: PastBatchRow }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 text-sm">
      <span className="text-muted-foreground w-20 shrink-0">
        {formatDate(row.completedAt)}
      </span>
      <span className="flex-1 text-foreground truncate">{row.theme}</span>
      <span className="text-muted-foreground shrink-0">
        {row.totalPosts} posts <span aria-hidden>✓</span>
      </span>
    </li>
  );
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
}
```

### 3. Native disclosure styling notes

- `list-style: none` on `<summary>` via `list-none` to suppress the default browser marker.
- `group-open:rotate-90` on the chevron uses Tailwind's `group` modifier to flip the arrow when the disclosure is open. Works because `group` is on `<details>` and `:has(...)`-like state is exposed via `[open]` — Tailwind's `group-open:` covers this.
- If `group-open:` doesn't work in the project's Tailwind v4 setup, fall back to a CSS selector `details[open] > summary svg { transform: rotate(90deg); }`.

### 4. Empty state inside the disclosure

The "No finished batches" line lives *inside* the body — visible only after the user opens the disclosure. The summary line still shows `Past batches (0)` so users can see whether there's content before opening.

### 5. Date formatting

`Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })` → `"May 14"`. Browser locale-aware, no manual month tables. Year is omitted since Past Batches is window-bounded to the current 30-day period.

### 6. Truncation

Long themes truncate with `truncate` (CSS `text-overflow: ellipsis`). The total-posts column is `shrink-0` to ensure it always renders.

## Acceptance Criteria

- [ ] `<PastBatchesList rows={[]} />` shows `Past batches (0)` disclosure; opening reveals `"No finished batches in this period."`
- [ ] `<PastBatchesList rows={[...]} />` shows the count and reveals compact rows on open.
- [ ] Each row renders `Mon Day` + theme (truncated) + `N posts ✓`.
- [ ] Chevron rotates 90° on open via CSS / Tailwind state.
- [ ] Keyboard: `Enter` / `Space` on the summary toggles the disclosure (native behavior).
- [ ] Screen-reader: native `<details>` exposes `aria-expanded` automatically.
- [ ] Date formatting uses browser locale.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- Native `<details>` is preferred over Radix `<Collapsible>` here for: zero JS cost (server-rendered), simpler keyboard semantics, and no client-component requirement.
- The ✓ uses the literal character rather than a Lucide `Check` to keep the rows visually compact. `aria-hidden` because the row already says "N posts" — the check is decorative.
- Past batches order: task-02 returns them sorted ASC (oldest first). Reverse here if reverse-chronological reads better — leave as ASC for Stage-1 since the list is empty anyway and ASC matches the Pro ordinal reading order.

## Out of scope

- Pagination / infinite scroll. Window cap is 4 batches → max 4 rows.
- Click-to-expand a row to see all posts. That data lives at `/posts?batchId={id}` and is wizard-only.
- Re-run / duplicate batch from a row. Out of scope.
- Engagement metrics. Not in v1 schema.
