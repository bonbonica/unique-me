# Task 10: Wizard Summary — Selected Combinations + Schedule My Pick

## Status
not started

## Wave
5

## Description

Build `<WizardSummary />` — the final step of the wizard. Lists every selected (post, network) combination as a discrete item with an X-to-remove button, shows an empty state if nothing is selected, and has the primary "Schedule my pick" commit button.

## Dependencies

**Depends on:** task-08 (wizard skeleton), task-05 (`scheduleMyPick` service method)
**Blocks:** task-14
**Context from dependencies:** `<WizardSummary>` is rendered as the final step inside `<NetworkWizard>`. Server actions `deselectForNetworkAction` and `scheduleMyPickAction` exist in `posts/actions.ts`.

## Files to Create / Modify

- `src/components/posts/wizard-summary.tsx` — NEW (replaces stub from task-08)

## Implementation Steps

### 1. Component signature

```tsx
"use client";

import { useOptimistic, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { WeeklyBatch, Post, PostVariation, SelectionPlatform } from "@/lib/schema";
import {
  deselectForNetworkAction,
  scheduleMyPickAction,
} from "@/app/(app)/(onboarded)/posts/actions";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

type PostWithExtras = Post & {
  variations: { instagram?: PostVariation; linkedin?: PostVariation };
  selections: SelectionPlatform[];
};

export function WizardSummary({
  batch,
  posts,
  platforms,
}: {
  batch: WeeklyBatch;
  posts: PostWithExtras[];
  platforms: SelectionPlatform[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build flat list of (post, platform) items from selections
  type Item = { postId: string; postOrder: number; postText: string; platform: SelectionPlatform };
  const initialItems: Item[] = [];
  for (const post of posts) {
    for (const platform of post.selections) {
      if (platforms.includes(platform)) {
        initialItems.push({
          postId: post.id,
          postOrder: post.postOrder,
          postText: post.postText,
          platform,
        });
      }
    }
  }

  // Optimistic removal
  const [items, removeOptimistic] = useOptimistic(
    initialItems,
    (state, key: string) => state.filter((i) => `${i.postId}:${i.platform}` !== key)
  );
  const [, startTransition] = useTransition();

  const isEmpty = items.length === 0;

  async function handleSchedule() {
    setSubmitting(true);
    setError(null);
    const result = await scheduleMyPickAction(batch.id);
    if (result.ok) {
      router.refresh();   // /posts re-renders, now in `scheduling` state → <LockedSummary />
    } else {
      setError(errorCopy(result.error));
    }
    setSubmitting(false);
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
          Review your week
        </h2>
        <p className="text-sm text-muted-foreground">
          Here&apos;s everything you&apos;ve picked. Remove anything you don&apos;t want before scheduling.
        </p>
      </header>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={`${item.postId}:${item.platform}`}
              className="flex items-center justify-between gap-3 bg-card border border-border rounded-lg px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Post {item.postOrder} to {networkLabel(item.platform)}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {item.postText}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove this selection"
                onClick={() => {
                  const key = `${item.postId}:${item.platform}`;
                  removeOptimistic(key);
                  startTransition(async () => {
                    await deselectForNetworkAction(item.postId, item.platform);
                  });
                }}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <div role="alert" className="text-destructive text-sm">{error}</div>}

      {!isEmpty && (
        <div className="flex justify-end border-t border-border pt-6">
          <Button
            size="lg"
            className="rounded-full glow-champagne"
            onClick={handleSchedule}
            disabled={submitting}
          >
            {submitting ? "Scheduling..." : "Schedule my pick"}
          </Button>
        </div>
      )}
    </section>
  );
}
```

### 2. `<EmptyState />` (inline)

```tsx
function EmptyState() {
  return (
    <div className="text-center py-12 bg-muted rounded-2xl">
      <p className="text-base text-foreground">No posts selected.</p>
      <p className="text-sm text-muted-foreground mt-2">
        Go back to any network step and check the posts you want to publish.
      </p>
    </div>
  );
}
```

### 3. Error copy

```tsx
function errorCopy(err: string): string {
  switch (err) {
    case "no_selections":          return "Pick at least one post-network combination first.";
    case "batch_already_locked":    return "This batch is already scheduled or cancelled.";
    case "not_owned":               return "You don't have access to this batch.";
    case "not_found":               return "Batch not found.";
    case "db_failed":               return "Couldn't save your selections. Try again.";
    default:                        return "Something went wrong. Try again.";
  }
}
```

## Acceptance Criteria

- [ ] Summary lists every `post_selections` row as `Post X to {Network}` with post-text preview
- [ ] X button removes the item optimistically; server resolves via `deselectForNetworkAction`
- [ ] Empty state shown when zero items; "Schedule my pick" button is hidden in empty state
- [ ] "Schedule my pick" click calls `scheduleMyPickAction` → on success `router.refresh()` re-renders the page as `<LockedSummary />`
- [ ] Submitting state on button (disabled + label change)
- [ ] All error variants render with the right copy
- [ ] Items ordered by `postOrder` then by platform (canonical order: FB → IG → LI)
- [ ] `npm run lint` and `npm run typecheck` clean

## Notes

- Don't show a separate Back button — `<WizardNav>` already provides Back on the summary step (per task-08).
- After `router.refresh()`, the server-side `PostsPage` re-evaluates `batch.status` (now `"scheduling"`) and routes to `<LockedSummary />` automatically. No client-side navigation needed.
- If the user removes the last item with the X button while the page is rendered, the summary re-renders in empty state — they're prompted to go back via `<WizardNav>`'s Back button.
