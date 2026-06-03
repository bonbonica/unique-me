# Task 11: /schedule page — layout

## Status
not started

## Wave
4

## Description

Replace the existing placeholder at `src/app/(app)/(onboarded)/schedule/page.tsx` ("Coming soon") with the real Scheduled hub: current-period batch boxes, Past Batches disclosure, and an empty state when both lists are empty. Wires up the `<CancelBatchDialog />` state at the page level.

## Dependencies

**Depends on:** task-02 (`getScheduledViewForUser`), task-08 (`<ScheduledBatchBox />`), task-09 (`<PastBatchesList />`), task-10 (`<CancelBatchDialog />`).
**Blocks:** task-12 (audit).

## Files to Modify

- `src/app/(app)/(onboarded)/schedule/page.tsx` (modified — full replacement of the placeholder).
- `src/components/schedule/scheduled-page-client.tsx` (new) — client wrapper that owns the dialog state.

## Implementation Steps

### 1. The server page

```tsx
// schedule/page.tsx
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";
import { ScheduledPageClient } from "@/components/schedule/scheduled-page-client";

export default async function SchedulePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const view = await postService.getScheduledViewForUser(session.user.id);

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <header>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Scheduled
        </h1>
      </header>

      <ScheduledPageClient view={view} />
    </div>
  );
}
```

The page is **server**. All data fetching here. No `Sparkles` "Coming soon" badge.

### 2. The client wrapper

```tsx
// scheduled-page-client.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScheduledBatchBox } from "./scheduled-batch-box";
import { PastBatchesList } from "./past-batches-list";
import { CancelBatchDialog } from "./cancel-batch-dialog";
import type { ScheduledView } from "@/lib/services/post-service";

type Props = { view: ScheduledView };

export function ScheduledPageClient({ view }: Props) {
  const [cancelTarget, setCancelTarget] = useState<{
    id: string;
    totalPosts: number;
    alreadyPostedCount: number;
    queuedCount: number;
  } | null>(null);

  const isEmpty = view.current.length === 0 && view.past.length === 0;

  if (isEmpty) {
    return (
      <section className="space-y-4">
        <p className="text-base text-muted-foreground leading-7">
          You don&apos;t have any scheduled batches yet.
        </p>
        <Button asChild>
          <Link href="/create">
            Start a new batch <ArrowRight className="ml-1 size-4" aria-hidden />
          </Link>
        </Button>
      </section>
    );
  }

  return (
    <>
      {view.current.length > 0 && (
        <section className="space-y-6" aria-label="Current period batches">
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
      )}

      <section aria-label="Past batches">
        <PastBatchesList rows={view.past} />
      </section>

      {cancelTarget && (
        <CancelBatchDialog
          batchId={cancelTarget.id}
          totalPosts={cancelTarget.totalPosts}
          alreadyPostedCount={cancelTarget.alreadyPostedCount}
          queuedCount={cancelTarget.queuedCount}
          open={!!cancelTarget}
          onOpenChange={(open) => !open && setCancelTarget(null)}
        />
      )}
    </>
  );
}
```

### 3. Empty-state logic

`isEmpty` = no current AND no past. Renders the one-line copy + `[Start a new batch →]` CTA. When at least one current box exists, the Past Batches disclosure still renders below — empty or not — so users can find finished work.

When current is empty but past has entries: the page shows no Current section header, just the disclosure. The page-level header `"Scheduled"` still appears.

### 4. Wire `revalidatePath("/schedule")` reception

The cancel action revalidates `/schedule`. Next.js will refresh the server component on the next navigation or via the `useTransition` re-render in the dialog. No additional client-side cache invalidation needed.

### 5. Remove the placeholder

Delete the entire body of the existing `schedule/page.tsx` and replace with the server component above. The `Sparkles` import and the "Coming soon" badge go away.

## Acceptance Criteria

- [ ] `/schedule` no longer shows "Coming soon" — page renders the new hub.
- [ ] Header reads `"Scheduled"` (Fraunces h1).
- [ ] Current-period `scheduling` batches render as `<ScheduledBatchBox />` boxes.
- [ ] Past Batches disclosure renders below the boxes (or alone if no current boxes).
- [ ] Both lists empty → empty-state copy + `[Start a new batch →]` button linking to `/create`.
- [ ] `[Cancel batch]` on a box opens `<CancelBatchDialog />` with the right batch's data.
- [ ] After successful cancel, page refreshes and the cancelled box disappears.
- [ ] Page is server-component for data; client wrapper owns dialog state.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The page lives inside the `(onboarded)` layout, so the top pill + sidebar are already in place via the layout. This task does not duplicate them.
- Stage-1: in production, the Current section will usually be empty (no posting-service yet to advance batches). The empty state will be common. The empty-state copy is honest and non-apologetic.
- Per DESIGN.md §8 pattern B (editorial content): `max-w-3xl`, generous `space-y-12` between sections.

## Out of scope

- Calendar view (Phase 4).
- Per-batch detail view linked from the box.
- Filtering / sorting controls.
- Sticky header / top pill duplication.
- Loading skeletons (server-rendered, instant).
