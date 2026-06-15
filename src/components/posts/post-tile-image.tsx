import { ImageOff } from "lucide-react";
import type { PostImageStatus } from "@/lib/services/post-service";

/**
 * Image-generation Wave 1 Stage 5: per-tile image renderer. Replaces the
 * pre-Wave-1 `"Image — Phase 3"` placeholder rectangle that lived inline
 * in `wizard-step.tsx`, `wizard-summary.tsx`, and `locked-summary.tsx`.
 *
 * Three render states, all sized by the parent's `aspectClass` so the
 * tile layout is identical across them (no layout shift when an image
 * transitions from skeleton to loaded):
 *
 *  - `status === "success"` AND `imageUrl != null` → the actual image.
 *  - `status === "pending"` or `"generating"` → an `animate-pulse`
 *    skeleton on `bg-muted` (no spinner, no text — the slot is busy,
 *    no user action is needed).
 *  - `status === "failed"` OR image is undefined OR (success without
 *    imageUrl, defensive) → a static "no image" placeholder with a
 *    faint `ImageOff` icon. Wave 2 will add a Retry button here; Wave
 *    1 leaves the area neutral with no controls.
 *
 * The `image === undefined` branch covers two real cases: (1) pre-Wave-1
 * legacy batches with no `post_images` rows, and (2) clients that haven't
 * received the first poll yet for a brand-new batch. Both should look
 * the same — quiet placeholder, not a loading state, since we have no
 * positive signal that work is in flight.
 */
export function PostTileImage({
  image,
  aspectClass,
  alt,
}: {
  image: PostImageStatus | undefined;
  aspectClass: string;
  alt: string;
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

  // `failed`, `undefined`, or the defensive `success`-without-`imageUrl` path.
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
