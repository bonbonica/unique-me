# Task 09: Wizard Step — Per-Network Card Grid

## Status
not started

## Wave
5

## Description

Build `<WizardStep platform={...} posts={...} batchTheme={...} />` — the per-network step that renders 7 cards in that network's preview format. Each card has the platform-specific text, an aspect-ratio placeholder, one checkbox, and Edit + Regenerate buttons. Implements the stale-variation inline note (R12) and the universal 1× regen cap UI state (D11).

## Dependencies

**Depends on:** task-08 (wizard skeleton), task-04 (`selectForNetwork`, `deselectForNetwork`, `update`, `regenerate` service methods), task-12 (`<EditDialog />`, `<RegenerateDialog />`)
**Blocks:** task-14
**Context from dependencies:** Server actions in `posts/actions.ts` are wired. Dialog components exist. `BatchForReview.posts` array has each post's `variations` and `selections` fields.

## Files to Create / Modify

- `src/components/posts/wizard-step.tsx` — NEW (replace stub from task-08)

## Implementation Steps

### 1. Component signature

```tsx
"use client";

import { useOptimistic, useState, useTransition } from "react";
import type { Post, PostVariation, SelectionPlatform } from "@/lib/schema";
import {
  selectForNetworkAction,
  deselectForNetworkAction,
} from "@/app/(app)/(onboarded)/posts/actions";
import { EditDialog } from "./edit-dialog";
import { RegenerateDialog } from "./regenerate-dialog";

type PostWithExtras = Post & {
  variations: { instagram?: PostVariation; linkedin?: PostVariation };
  selections: SelectionPlatform[];
};

export function WizardStep({
  platform,
  posts,
  batchTheme,
}: {
  platform: SelectionPlatform;
  posts: PostWithExtras[];
  batchTheme: string;
}) {
  // ...
}
```

### 2. Header

```tsx
<header className="space-y-2">
  <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
    Review for {networkLabel(platform)}
  </h2>
  <p className="text-sm text-muted-foreground">
    Check the posts you want to publish on {networkLabel(platform)}. You can come back to any step.
  </p>
</header>
```

`networkLabel("facebook")` → `"Facebook"`, etc.

### 3. Card grid

Responsive: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`.

Each card renders:

```tsx
<PostCardForStep
  key={post.id}
  post={post}
  platform={platform}
/>
```

### 4. `<PostCardForStep>` (inline component within this file)

```tsx
function PostCardForStep({
  post,
  platform,
}: {
  post: PostWithExtras;
  platform: SelectionPlatform;
}) {
  const isSelected = post.selections.includes(platform);

  // Optimistic selection state
  const [optimistic, setOptimistic] = useOptimistic(
    isSelected,
    (_state, newValue: boolean) => newValue
  );
  const [, startTransition] = useTransition();

  const text = textFor(post, platform);
  const hashtags = hashtagsFor(post, platform);
  const aspectClass = aspectRatioFor(platform);   // see R8
  const showStaleNote = isVariationStale(post, platform);

  const canRegen = post.regenerationCount < 1;

  return (
    <Card className="bg-card rounded-2xl border border-border shadow-soft p-6 flex flex-col gap-4 card-interactive">
      <div className="flex items-center justify-between">
        <Badge>Post {post.postOrder} / 7</Badge>
        <PlatformIcon platform={platform} />
      </div>

      {/* Image placeholder (Phase 2 — no real images) */}
      <div className={`bg-muted rounded-lg ${aspectClass} flex items-center justify-center text-xs text-muted-foreground`}>
        Image — Phase 3
      </div>

      {/* Text */}
      <div className="space-y-2">
        <p className="text-base leading-7 whitespace-pre-wrap">{text}</p>
        {hashtags.length > 0 && (
          <p className="text-sm text-primary">{hashtags.map(h => `#${h}`).join(" ")}</p>
        )}
        {showStaleNote && <StaleVariationNote canRegen={canRegen} platform={platform} />}
      </div>

      {/* Checkbox */}
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <Checkbox
          checked={optimistic}
          onCheckedChange={(checked) => {
            const next = Boolean(checked);
            setOptimistic(next);
            startTransition(async () => {
              if (next) {
                await selectForNetworkAction(post.id, platform);
              } else {
                await deselectForNetworkAction(post.id, platform);
              }
            });
          }}
        />
        Post this to {networkLabel(platform)}?
      </label>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <EditDialog post={post} />
        <RegenerateDialog
          post={post}
          disabled={!canRegen}
          disabledTooltip="You've already regenerated this post."
        />
      </div>
    </Card>
  );
}
```

### 5. Text + hashtag helpers

```tsx
function textFor(post: PostWithExtras, platform: SelectionPlatform): string {
  if (platform === "facebook") return post.postText;
  if (platform === "instagram") return post.variations.instagram?.postText ?? FALLBACK_NO_VARIATION;
  if (platform === "linkedin") return post.variations.linkedin?.postText ?? FALLBACK_NO_VARIATION;
  return post.postText;
}

function hashtagsFor(post: PostWithExtras, platform: SelectionPlatform): string[] {
  if (platform === "facebook") return post.hashtags;
  if (platform === "instagram") return post.variations.instagram?.hashtags ?? [];
  if (platform === "linkedin") return post.variations.linkedin?.hashtags ?? [];
  return [];
}

const FALLBACK_NO_VARIATION =
  "No variation available — toggle Edit to write one manually, or Regenerate to retry.";
```

### 6. Aspect ratio helper (R8)

```tsx
function aspectRatioFor(platform: SelectionPlatform): string {
  switch (platform) {
    case "facebook":  return "aspect-square";          // 1:1
    case "instagram": return "aspect-square";          // 1:1
    case "linkedin":  return "aspect-[1.91/1]";        // 1.91:1
  }
}
```

### 7. Stale-variation note (R12)

```tsx
function isVariationStale(post: PostWithExtras, platform: SelectionPlatform): boolean {
  if (platform === "facebook") return false;        // canonical is never stale
  if (post.status !== "edited") return false;

  const variation = platform === "instagram" ? post.variations.instagram : post.variations.linkedin;
  if (!variation) return false;

  // Variation older than the canonical post's last update
  return variation.createdAt < post.updatedAt;
}

function StaleVariationNote({
  canRegen,
  platform,
}: {
  canRegen: boolean;
  platform: SelectionPlatform;
}) {
  const network = networkLabel(platform);
  const action = canRegen
    ? "Regenerate (1 left) to refresh both."
    : "Edit this post to update both.";
  return (
    <p className="text-xs italic text-muted-foreground">
      You edited this post on the Facebook step — the {network} version may be older. {action}
    </p>
  );
}
```

## Acceptance Criteria

- [ ] `<WizardStep platform="facebook" />` renders 7 cards each showing the canonical post + hashtags
- [ ] `<WizardStep platform="instagram" />` renders 7 cards each showing the IG variation text (or fallback if missing)
- [ ] `<WizardStep platform="linkedin" />` renders 7 cards each showing the LI variation
- [ ] Aspect-ratio placeholder matches R8 per platform
- [ ] Checking the checkbox calls `selectForNetworkAction`; unchecking calls `deselectForNetworkAction`
- [ ] Optimistic UI: checkbox responds immediately, server resolves in background
- [ ] Stale-variation note appears only on IG/LI steps when `posts.status === "edited"` AND variation older than `posts.updatedAt`
- [ ] Note copy switches between "(1 left)" and "Edit this post" based on `regenerationCount`
- [ ] Regenerate button is disabled when `regenerationCount >= 1` with tooltip
- [ ] `npm run lint`, `npm run typecheck` clean

## Notes

- `useOptimistic` is preferred over manual state for the checkbox so the UI doesn't flicker on slow networks.
- The page-level fetched `posts` array is the source of truth for the rendered card content. After Edit or Regenerate (dialogs), the dialog itself can call `router.refresh()` to re-render with new data. Task-12 covers this.
- The `<Checkbox />` component from shadcn is already installed (see `src/components/ui/checkbox.tsx`).
