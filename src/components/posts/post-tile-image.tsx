import { ImageOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PostImageStatus } from "@/lib/services/post-service";

/**
 * Image-generation Wave 1 Stage 5 + Wave 2 Stage 3: per-tile image renderer.
 * Replaces the pre-Wave-1 `"Image — Phase 3"` placeholder that lived inline
 * in `wizard-step.tsx`, `wizard-summary.tsx`, and `locked-summary.tsx`.
 *
 * Render states (all sized by `aspectClass` so transitions are no-shift):
 *
 *  - `status === "success"` AND `imageUrl != null` → the actual image.
 *  - `status === "pending"` or `"generating"` → `animate-pulse` skeleton.
 *  - `status === "failed"` AND `attempt < 2` AND `onRetry` wired → ImageOff
 *    icon + "Try again" button (Wave 2 Stage 3, all tiers).
 *  - `status === "failed"` AND `attempt >= 2` → ImageOff icon + static
 *    "Couldn't generate this image." message (cap reached, no further
 *    attempts allowed).
 *  - `status === "failed"` AND `attempt < 2` AND no `onRetry` → quiet
 *    placeholder (e.g., locked-summary path with no polling loop yet).
 *  - `image === undefined` OR defensive success-without-url → quiet
 *    placeholder.
 *
 * The `image === undefined` branch covers two real cases: (1) pre-Wave-1
 * legacy batches with no `post_images` rows, and (2) clients that haven't
 * received the first poll yet for a brand-new batch. Both should look the
 * same — quiet placeholder, not a loading state, since we have no positive
 * signal that work is in flight.
 *
 * Wave 2 props (`onRetry`, `postId`) are optional so consumers without a
 * polling loop (locked-summary) can render the same tile without wiring a
 * retry handler. The exhausted message still renders correctly there.
 */
export function PostTileImage({
  image,
  aspectClass,
  alt,
  onRetry,
  postId,
}: {
  image: PostImageStatus | undefined;
  aspectClass: string;
  alt: string;
  onRetry?: ((postId: string) => void) | undefined;
  postId?: string;
}) {
  if (image?.status === "success" && image.imageUrl) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg bg-muted ${aspectClass}`}
      >
        {/* Plain <img> rather than next/image — the tile dimensions are
            already set by the parent's aspectClass, and AI images load
            from arbitrary Blob URLs that next/image's loader would have
            to be configured to accept. Wave 1 favours simplicity here;
            optimisation can come later. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.imageUrl}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }

  if (image?.status === "pending" || image?.status === "generating") {
    return (
      <div
        className={`bg-muted rounded-lg ${aspectClass} animate-pulse`}
        role="status"
        aria-label="Image is being generated"
      />
    );
  }

  if (image?.status === "failed") {
    const exhausted = image.attempt >= 2;
    // Capture the closure once so TypeScript narrows `onRetry` / `postId`
    // here rather than at every JSX consumer.
    const retryClick =
      !exhausted && onRetry && postId ? () => onRetry(postId) : null;

    return (
      <div
        className={`bg-muted rounded-lg ${aspectClass} flex flex-col items-center justify-center gap-3 px-4 text-muted-foreground`}
        role="img"
        aria-label="Image generation failed"
      >
        <ImageOff className="size-6 opacity-40" aria-hidden />
        {retryClick ? (
          <Button variant="secondary" size="sm" onClick={retryClick}>
            <RefreshCw className="size-4" strokeWidth={1.5} aria-hidden />
            Try again
          </Button>
        ) : exhausted ? (
          <p className="text-sm text-center">
            Couldn&apos;t generate this image.
          </p>
        ) : null}
      </div>
    );
  }

  // `undefined` image OR defensive success-without-imageUrl: quiet placeholder.
  return (
    <div
      className={`bg-muted rounded-lg ${aspectClass} flex items-center justify-center text-muted-foreground`}
      role="img"
      aria-label="No image available"
    >
      <ImageOff className="size-6 opacity-40" aria-hidden />
    </div>
  );
}
