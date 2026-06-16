# Stage 3 — UI: Retry on failed tiles

**Goal:** every failed image tile gets a "Try again" button when `attempt < 2`. Exhausted tiles show a single-sentence message and no control. Works for all tiers. No regenerate / no Pro-only paths in this stage — Stage 4 owns that.

Read `spec.md` first, especially §Behaviour matrix.

**Prereq:** Stage 1 + Stage 2 committed and green.

---

## Files to touch

1. `src/components/posts/post-tile-image.tsx` — add retry button + exhausted-message states
2. `src/components/posts/network-wizard.tsx` — wire `onRetry` handler, optimistic UI, reason → toast mapping

---

## Steps

### 1. Tile component

`src/components/posts/post-tile-image.tsx` — extend props:

```ts
type Props = {
  image: PostImageStatus | undefined;
  aspectClass: string;
  alt: string;
  onRetry?: (postImageId: string, /* internal id of the post_images row */) => void;
  postImageId?: string;  // pass-through so the handler knows which row
};
```

(If the tile already has access to the row id via `image.id`, use that and skip the prop. Inspect the existing types.)

Branch the failed-state render by `image.attempt`:

```tsx
// Existing failed state — currently shows just the ImageOff icon + placeholder
if (image?.status === 'failed') {
  return (
    <div className={cn('rounded-2xl bg-muted flex flex-col items-center justify-center gap-3', aspectClass)}>
      <ImageOff className="size-8 text-muted-foreground/70" strokeWidth={1.5} />
      {image.attempt < 2 ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRetry?.(/* row id */)}
          disabled={/* local in-flight flag — see Step 2 */}
        >
          <RefreshCw className="size-4" strokeWidth={1.5} />
          Try again
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Couldn't generate this image.</p>
      )}
    </div>
  );
}
```

Visual notes per DESIGN.md:
- `Button variant="secondary"` is `rounded-full` per §9.
- Icons stroke 1.5 per §10.
- `text-muted-foreground` for the exhausted message; never below `text-sm` (§4).
- No exclamation point in the copy (§14).

### 2. Wire from `network-wizard.tsx`

In `src/components/posts/network-wizard.tsx`:

```ts
import { retryImageAction } from '@/app/(app)/(onboarded)/posts/actions';
import { toast } from 'sonner';
```

Add an `onRetry` handler:

```ts
const handleRetry = async (postImageId: string) => {
  // 1. Capture the pre-click snapshot for revert-on-error.
  const prevStatus = imagesRef.current[postIdForImage]?.status;

  // 2. Optimistic local update: flip the tile to 'generating' so the
  //    skeleton renders immediately. Increment local attempt to 2 so the
  //    retry button can't be re-clicked while the request is in flight.
  setImages((prev) => ({
    ...prev,
    [postIdForImage]: {
      ...prev[postIdForImage],
      status: 'generating',
      attempt: 2,
    },
  }));

  // 3. Fire the action.
  const result = await retryImageAction(postImageId);

  // 4. On failure: revert and toast.
  if (!result.ok) {
    setImages((prev) => ({
      ...prev,
      [postIdForImage]: {
        ...prev[postIdForImage],
        status: prevStatus ?? 'failed',
        attempt: 1,
      },
    }));
    toast.error(retryReasonCopy(result.reason));
    return;
  }

  // 5. Success: server has set status='generating' and attempt=2. Polling
  //    will pick up the final state. No further action.
};

const retryReasonCopy = (reason: string) => {
  switch (reason) {
    case 'not_owned': return "You don't have access to this image.";
    case 'not_failed': return "This image was already updated. Refresh to see the latest.";
    case 'attempts_exhausted': return "No more attempts left for this image.";
    case 'already_in_progress': return "Already retrying — give it a moment.";
    default: return "Something went wrong. Try again in a moment.";
  }
};
```

Thread the handler down to the tile:

```tsx
<PostTileImage
  image={images[post.id]}
  aspectClass={...}
  alt={...}
  onRetry={handleRetry}
  postImageId={images[post.id]?.id /* however the row id is accessible */}
/>
```

Polling already covers the rest — it sees the row transition to `success` or `failed` and updates the tile.

### 3. Confirm the row id flows to the handler

The action takes a `post_images.id` (the row id, NOT `post.id`). Verify which id is available in `images[post.id]` — Wave 1 keys by `postId` but each tile needs the underlying `post_images.id`. If not already returned by `getBatchImageStatusesAction`, add it to the SELECT — this is the only Stage-2-adjacent fix-up; do it here if missed.

---

## Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run build` all pass.
2. **Manual flow — happy path:** force a tile into `status='failed'` via DB edit. Reload review page. Tile shows "Try again". Click it. Tile flips to skeleton. Within ~10s, tile lands either on the new image or on the exhausted message.
3. **Manual flow — exhausted:** force a row to `status='failed', attempt=2`. Tile shows "Couldn't generate this image." with no button.
4. **Manual flow — concurrency:** click the button rapidly. Only one OpenAI call fires (verified by server log). The second click resolves to a toast or is silently ignored (button is disabled while in flight).
5. **Manual flow — auth bypass:** open devtools, manually invoke `retryImageAction` with a row id you don't own. Server returns `not_owned`. Toast appears.
6. No regressions: initial batch gen still works.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT add the regenerate icon to success tiles — Stage 4.
- Do NOT add the dimmed-overlay rendering for `'regenerating'` — Stage 4.
- Do NOT add the "kept original" toast — Stage 4.
- Do NOT thread `isPro` — Stage 4.
- Do NOT change the polling cadence.
- Do NOT touch `image-service.ts` or the server actions.
