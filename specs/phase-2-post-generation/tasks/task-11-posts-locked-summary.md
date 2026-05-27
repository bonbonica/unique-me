# Task 11: Locked Summary — Read-only View for Scheduling + Cancelled

## Status
not started

## Wave
5

## Description

Build `<LockedSummary />` — the read-only view rendered when `batch.status === "scheduling"` or `"cancelled"`. Same visual structure as `<WizardSummary />` (list of selected combinations) but with no remove buttons and no nav. In `scheduling` it shows a "Stop entire batch" button (with confirmation dialog). In `cancelled` it shows a banner explaining the batch was cancelled + a link to start a new batch.

## Dependencies

**Depends on:** task-05 (`stopBatch` service method)
**Blocks:** task-14
**Context from dependencies:** `stopBatchAction` server action exists in `posts/actions.ts`. `BatchForReview` data shape from `getBatchForReview`.

## Files to Create / Modify

- `src/components/posts/locked-summary.tsx` — NEW (replaces stub from task-08)

## Implementation Steps

### 1. Component signature

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BatchForReview } from "@/lib/schema";
import { stopBatchAction } from "@/app/(app)/(onboarded)/posts/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function LockedSummary({ data }: { data: BatchForReview }) {
  const router = useRouter();
  const isCancelled = data.batch.status === "cancelled";
  const isScheduling = data.batch.status === "scheduling";

  // Build flat item list (same shape as wizard-summary but read-only)
  type Item = { postId: string; postOrder: number; postText: string; platform: string };
  const items: Item[] = [];
  for (const post of data.posts) {
    for (const platform of post.selections) {
      items.push({
        postId: post.id,
        postOrder: post.postOrder,
        postText: post.postText,
        platform,
      });
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {isCancelled ? "Batch cancelled" : "Your selections are locked"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isCancelled
            ? "This batch was cancelled. Nothing was posted."
            : "Your selections are locked. Stopping will cancel the batch."}
        </p>
      </header>

      {isCancelled && (
        <Banner>
          <Link href="/create" className="underline">Start a new batch →</Link>
        </Banner>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No posts were selected.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={`${item.postId}:${item.platform}`}
              className="bg-card border border-border rounded-lg px-4 py-3 opacity-90"
            >
              <p className="text-sm font-medium">
                Post {item.postOrder} to {networkLabel(item.platform)}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {item.postText}
              </p>
            </li>
          ))}
        </ul>
      )}

      {isScheduling && (
        <div className="border-t border-border pt-6">
          <StopBatchDialog batchId={data.batch.id} onSuccess={() => router.refresh()} />
        </div>
      )}
    </div>
  );
}
```

### 2. `<StopBatchDialog>` inline

```tsx
function StopBatchDialog({
  batchId,
  onSuccess,
}: {
  batchId: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    const result = await stopBatchAction(batchId);
    if (result.ok) {
      setOpen(false);
      onSuccess();
    } else {
      setError(stopErrorCopy(result.error));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="rounded-lg">
          Stop entire batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop entire batch?</DialogTitle>
          <DialogDescription>
            This cancels the batch. Nothing posts to any network. You can&apos;t undo this.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Never mind
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Cancelling..." : "Yes, stop it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 3. `<Banner />` (small inline component)

```tsx
function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-muted px-6 py-4 text-sm">
      {children}
    </div>
  );
}
```

### 4. Error copy for stop

```tsx
function stopErrorCopy(err: string): string {
  switch (err) {
    case "not_scheduling":   return "This batch isn't in a state that can be stopped.";
    case "not_owned":        return "You don't have access to this batch.";
    case "not_found":        return "Batch not found.";
    case "db_failed":        return "Couldn't cancel the batch. Try again.";
    default:                 return "Something went wrong.";
  }
}
```

## Acceptance Criteria

- [ ] `<LockedSummary>` renders for `batch.status === "scheduling"` with the Stop button
- [ ] `<LockedSummary>` renders for `batch.status === "cancelled"` WITHOUT the Stop button + WITH the "Start a new batch" link
- [ ] Selection items are listed read-only (no X buttons, no remove behavior)
- [ ] Items have a slightly-muted opacity styling to signal locked state
- [ ] Stop button opens confirmation Dialog
- [ ] Confirming stop calls `stopBatchAction(batchId)`; on success `router.refresh()` re-renders the page as cancelled state
- [ ] If user has zero selections (empty `items` array) the lists render *"No posts were selected."* italic placeholder
- [ ] Trial users in cancelled state clicking "Start a new batch" → `/create` → see `<TrialGatedScreen />` (the cancelled batch still counts toward the trial 1-batch cap, D20)
- [ ] `npm run lint` and `npm run typecheck` clean

## Notes

- The "Start a new batch" link goes to `/create` for everyone. For trial users with cancelled batch, the `/create` page itself shows `<TrialGatedScreen />` — so the user lands on the gated screen rather than the form. That's the intended UX per D20.
- The Stop button is `variant="destructive"` — per DESIGN.md, the destructive variant uses the warm-coral token, not bright red.
- After `router.refresh()` on stop-success, the server reload sees `batch.status === "cancelled"` and re-renders this same component in cancelled mode automatically.
