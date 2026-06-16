# Stage 4 — UI: Regenerate for Pro

**Goal:** Pro users see a persistent corner regenerate icon on every successful tile (when `attempt < 2`). Clicking it dims the existing image and runs a second attempt. If the second attempt fails, the original survives and the user sees a "kept original" toast. Starter / free_trial users see no icon — the surface is invisible to them.

Read `spec.md` first, especially §Behaviour matrix.

**Prereq:** Stages 1, 2, 3 committed and green.

---

## Files to touch

1. `src/components/posts/network-wizard.tsx` — server-side resolve `isPro`, thread to tiles, add `handleRegenerate`, add "kept original" toast detection
2. `src/components/posts/post-tile-image.tsx` — add regenerate icon (success + a1 + isPro), add regenerating overlay state
3. Possibly: the page that renders `network-wizard.tsx` — if the component is currently a client component without server-resolved subscription data, thread `isPro` through from a server boundary

---

## Steps

### 1. Resolve `isPro` server-side

`network-wizard.tsx` is a client component (uses state + polling). The subscription read must happen server-side. Find the closest server boundary (likely the route's `page.tsx` or `layout.tsx`) and resolve:

```ts
// In the server component that renders <NetworkWizard ...>
import { subscriptionService } from '@/lib/services/subscription-service';

const sub = await subscriptionService.checkSubscription(userId);
const isPro = sub.plan === 'pro' && sub.status === 'active';

return <NetworkWizard ... isPro={isPro} />;
```

Add `isPro: boolean` to `NetworkWizard`'s props. Default to `false` if there's a reasonable client-only fallback (there shouldn't be — this should always be server-resolved).

### 2. Tile: regenerate icon (success + a1 + isPro)

`post-tile-image.tsx` — extend props:

```ts
type Props = {
  // ...existing
  isPro?: boolean;
  onRegenerate?: (postImageId: string) => void;
};
```

In the success branch:

```tsx
if (image?.status === 'success' && image.imageUrl) {
  return (
    <div className={cn('relative', aspectClass)}>
      <img src={image.imageUrl} alt={alt} className="w-full h-full object-cover rounded-2xl" />
      {isPro && image.attempt < 2 && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRegenerate?.(image.id)}
          className="absolute top-3 right-3 opacity-70 hover:opacity-100"
          aria-label="Regenerate image"
        >
          <RefreshCw className="size-4" strokeWidth={1.5} />
        </Button>
      )}
    </div>
  );
}
```

Button is `size="icon"` which per DESIGN.md §9 is `size-11` (44px square) — meets touch-target requirement.

### 3. Tile: regenerating overlay state

Add a new branch for `status === 'regenerating'`:

```tsx
if (image?.status === 'regenerating' && image.imageUrl) {
  return (
    <div className={cn('relative', aspectClass)}>
      <img
        src={image.imageUrl}
        alt={alt}
        className="w-full h-full object-cover rounded-2xl opacity-60"
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" strokeWidth={1.5} />
      </div>
    </div>
  );
}
```

If `imageUrl` is somehow null in a `'regenerating'` row (shouldn't happen — regenerate only acts on successful rows that already have one), fall through to the existing skeleton.

### 4. `handleRegenerate` in `network-wizard.tsx`

```ts
import { regenerateImageAction } from '@/app/(app)/(onboarded)/posts/actions';

const handleRegenerate = async (postImageId: string) => {
  const tilePostId = /* find the postId whose images[postId].id === postImageId */;
  const prev = imagesRef.current[tilePostId];
  if (!prev || prev.status !== 'success' || !prev.imageUrl) return;

  // Snapshot the original imageUrl for "kept original" detection later.
  const originalImageUrl = prev.imageUrl;

  // Optimistic flip: status to 'regenerating', imageUrl stays, attempt to 2.
  setImages((prev) => ({
    ...prev,
    [tilePostId]: {
      ...prev[tilePostId],
      status: 'regenerating',
      attempt: 2,
    },
  }));

  // Track the snapshot so the poll-loop can fire the "kept original" toast
  // if status flips back to 'success' with imageUrl unchanged.
  regenerateSnapshotsRef.current.set(tilePostId, originalImageUrl);

  const result = await regenerateImageAction(postImageId);

  if (!result.ok) {
    // Revert local state.
    setImages((prev) => ({
      ...prev,
      [tilePostId]: {
        ...prev[tilePostId],
        status: 'success',
        attempt: 1,
      },
    }));
    regenerateSnapshotsRef.current.delete(tilePostId);
    toast.error(regenerateReasonCopy(result.reason));
    return;
  }

  // Success path: polling will pick up the final state.
};

const regenerateReasonCopy = (reason: string) => {
  switch (reason) {
    case 'not_owned': return "You don't have access to this image.";
    case 'not_successful': return "This image was already updated. Refresh to see the latest.";
    case 'attempts_exhausted': return "No more attempts left for this image.";
    case 'already_in_progress': return "Already regenerating — give it a moment.";
    case 'pro_required': return "Regenerating an image is a Pro feature.";
    default: return "Something went wrong. Try again in a moment.";
  }
};
```

Add a ref to track snapshots:

```ts
const regenerateSnapshotsRef = useRef<Map<string, string>>(new Map());
```

### 5. "Kept original" toast detection

Inside the polling tick handler, after merging the fresh statuses into local state, walk the snapshots:

```ts
// After setImages with the polled values, check each tracked regenerate
// snapshot:
for (const [postId, originalUrl] of regenerateSnapshotsRef.current) {
  const fresh = freshImages[postId];
  if (!fresh) continue;

  // Transitioned regenerating → success?
  if (fresh.status === 'success' && fresh.attempt === 2) {
    if (fresh.imageUrl === originalUrl) {
      // Regenerate failed; original was preserved.
      toast.error('Regeneration failed. Kept the original image.');
    }
    // Either way (success or fail), the regenerate cycle is complete.
    regenerateSnapshotsRef.current.delete(postId);
  }
}
```

The detection must run AFTER the local state has caught up to the fresh poll values, OR be evaluated against the fresh values directly — implementer's call. The semantic: if `regenerating → success` with `attempt=2` and `imageUrl` unchanged → toast.

### 6. Thread `isPro` down to tiles

```tsx
<PostTileImage
  image={images[post.id]}
  aspectClass={...}
  alt={...}
  onRetry={handleRetry}
  onRegenerate={handleRegenerate}
  isPro={isPro}
/>
```

---

## Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run build` all pass.
2. **Pro user, success + a1:** corner icon visible. Click it → image dims + spinner overlay → within ~10s either (a) new image renders, no toast, no icon (attempt=2), or (b) original image stays visible + "Regeneration failed. Kept the original image." toast appears, no icon (attempt=2).
3. **Starter user / free_trial / Pro-expired:** NO corner icon on any success tile. Verify by setting subscription plan in DB to each value.
4. **Pro user, success + a2:** NO corner icon. (Used their one regenerate.)
5. **Forced regenerate failure:** temporarily make `generateImage` return `null` (or use an invalid `OPENAI_API_KEY`). Click regenerate as Pro. Confirm original survives + toast fires.
6. **Concurrency:** rapid double-click on the icon — only one OpenAI call. Second resolves to `already_in_progress` toast.
7. **Tab close mid-regenerate:** reload → tile is in `'regenerating'` state visually (dimmed original + spinner), polling resumes, final state is consistent.
8. **No regressions:** retry (Stage 3) still works for all tiers. Initial batch gen still works.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT add an "upgrade to Pro" tooltip or upsell anywhere on the tile — Starter sees nothing.
- Do NOT add a third attempt cap or a way to bypass the 2-cap.
- Do NOT add prompt editing.
- Do NOT add per-image cost telemetry.
- Do NOT add a "Regenerate succeeded" toast on the success path — the new image swap IS the success signal.
- Do NOT touch `runImageGenerationForRow` or the server actions.
- Do NOT change the polling cadence.
