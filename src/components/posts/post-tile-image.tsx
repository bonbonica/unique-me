import { ImageOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PostImageStatus } from "@/lib/services/post-service";

/**
 * Image-generation Wave 1 Stage 5 + Wave 2 Stages 3-4: per-tile image
 * renderer. Replaces the pre-Wave-1 `"Image — Phase 3"` placeholder.
 *
 * Render states (all sized by `aspectClass` so transitions are no-shift):
 *
 *  - `success` AND `imageUrl != null`:
 *     - Pro + `attempt < 2` + `onRegenerate` wired → image + corner
 *       `RefreshCw` ghost button (Wave 2 Stage 4 Pro-only regenerate).
 *     - Otherwise → image alone.
 *  - `regenerating` AND `imageUrl != null` (Wave 2 Stage 4) → original
 *    image at `opacity-60` + centered `Loader2` spinner overlay. The
 *    original URL is preserved server-side so a regenerate failure can
 *    revert seamlessly without flicker.
 *  - `pending` / `generating` (or `regenerating` without URL — defensive)
 *    → `animate-pulse` skeleton.
 *  - `failed` AND `attempt < 2` AND `onRetry` wired → ImageOff + "Try
 *    again" button (Wave 2 Stage 3, all tiers).
 *  - `failed` AND `attempt >= 2` → ImageOff + static "Couldn't generate
 *    this image." message (cap reached).
 *  - `failed` AND `attempt < 2` AND no `onRetry` → quiet placeholder
 *    (e.g., locked-summary path with no polling loop wired).
 *  - `image === undefined` OR defensive success-without-url → quiet
 *    placeholder.
 *
 * The `image === undefined` branch covers two real cases: (1) pre-Wave-1
 * legacy batches with no `post_images` rows, and (2) clients that haven't
 * received the first poll yet for a brand-new batch. Both should look the
 * same — quiet placeholder, not a loading state, since we have no positive
 * signal that work is in flight.
 *
 * Wave 2 props are all optional so consumers without a polling loop
 * (locked-summary) can render the same tile without wiring handlers.
 * The Pro regenerate icon requires `isPro` + `onRegenerate` + `postId`
 * all to be truthy; otherwise the success tile shows just the image.
 */
export function PostTileImage({
  image,
  aspectClass,
  alt,
  onRetry,
  onRegenerate,
  postId,
  isPro = false,
}: {
  image: PostImageStatus | undefined;
  aspectClass: string;
  alt: string;
  onRetry?: ((postId: string) => void) | undefined;
  onRegenerate?: ((postId: string) => void) | undefined;
  postId?: string;
  isPro?: boolean;
}) {
  if (image?.status === "success" && image.imageUrl) {
    // Capture the closure once so TypeScript narrows the handler in the
    // JSX consumer below without non-null assertions.
    const regenerateClick =
      isPro && image.attempt < 2 && onRegenerate && postId
        ? () => onRegenerate(postId)
        : null;

    return (
      <div
        className={`relative overflow-hidden rounded-lg bg-muted ${aspectClass}`}
      >
        {/* Plain <img> rather than next/image — the tile dimensions are
            already set by the parent's aspectClass, and AI images load
            from arbitrary Blob URLs that next/image's loader would have
            to be configured to accept. Wave 1 favours simplicity here;
            optimisation can come later. */}
        {/* Wave 2 cache-buster: `runImageGenerationForRow` overwrites the
            blob at the same Vercel Blob URL (path = `<id>.png`), so a
            successful regenerate produces NEW content at the SAME URL.
            Without the query suffix, the browser serves its cached copy
            even after polling updates state. Vercel's CDN ignores the
            query string; the browser uses the full URL as its cache key. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${image.imageUrl}?v=${image.attempt}-${image.status}`}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
        {regenerateClick ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={regenerateClick}
            className="absolute top-3 right-3 opacity-70 hover:opacity-100"
            aria-label="Regenerate image"
          >
            <RefreshCw className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
        ) : null}
      </div>
    );
  }

  if (image?.status === "regenerating" && image.imageUrl) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg bg-muted ${aspectClass}`}
        role="status"
        aria-label="Regenerating image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${image.imageUrl}?v=${image.attempt}-${image.status}`}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2
            className="size-7 animate-spin text-primary"
            strokeWidth={1.5}
            aria-hidden
          />
        </div>
      </div>
    );
  }

  if (
    image?.status === "pending" ||
    image?.status === "generating" ||
    image?.status === "regenerating"
  ) {
    // Wave 2 defensive: `regenerating` without imageUrl shouldn't be
    // reachable (regenerate only acts on successful rows that already
    // have one) but if we ever see it, render the same skeleton as
    // pending/generating rather than a broken overlay.
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
