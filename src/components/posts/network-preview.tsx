/**
 * Shared per-network preview primitives used by every `/posts` surface:
 *   - `<WizardStep />`     — interactive per-network card grid (Wave 5)
 *   - `<WizardSummary />`  — pre-commit summary card grid (Wave 5 polish)
 *   - `<LockedSummary />`  — post-commit / cancelled view (Wave 5 polish)
 *
 * Pulled out of those files once we had three call sites using the same
 * lookups (network labels, short badges, the text/hashtags resolver, the
 * aspect-ratio mapping). Anything that's still surface-specific — the
 * lucide icon row on the step header, the stale-variation note — stays
 * in its owning component.
 */

import type { SelectionPlatform } from "@/lib/schema";
import type { BatchForReview } from "@/lib/services/post-service";

export type PostWithExtras = BatchForReview["posts"][number];

export const NETWORK_LABELS: Record<SelectionPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

/**
 * Compact two/four-character labels for the network-badge chip on each
 * card. Mixed casing is intentional — "F" / "Insta" / "LI" — and matches
 * the conventional shorthand users see in marketing tools.
 */
export const NETWORK_SHORT_LABELS: Record<SelectionPlatform, string> = {
  facebook: "F",
  instagram: "Insta",
  linkedin: "LI",
};

/**
 * Stable sort key for cross-platform groupings (e.g. summary items
 * sorted by postOrder then by network). Locked to the canonical
 * `facebook → instagram → linkedin` order regardless of how the
 * underlying `selections` Records get serialised.
 */
export const NETWORK_ORDER_INDEX: Record<SelectionPlatform, number> = {
  facebook: 0,
  instagram: 1,
  linkedin: 2,
};

/**
 * Fallback caption when an IG / LinkedIn variation row is missing for a
 * post. The Zod schema marks variations as optional, so a Pro batch with
 * an unusually thin AI response can land in this state. The copy nudges
 * the user toward Edit (always available) rather than implying the post
 * is broken.
 */
export const NO_VARIATION_FALLBACK =
  "No variation available for this network yet. Edit this post to write one manually.";

/**
 * Resolve the caption text for the given (post, network) combo:
 *   - Facebook  → canonical `post.postText`
 *   - Instagram → `post.variations.instagram?.postText` or fallback
 *   - LinkedIn  → `post.variations.linkedin?.postText` or fallback
 */
export function textFor(
  post: PostWithExtras,
  platform: SelectionPlatform
): string {
  if (platform === "facebook") return post.postText;
  if (platform === "instagram") {
    return post.variations.instagram?.postText ?? NO_VARIATION_FALLBACK;
  }
  return post.variations.linkedin?.postText ?? NO_VARIATION_FALLBACK;
}

/**
 * Network-specific hashtag list. Empty array when a variation row is
 * missing — callers should render nothing (not `#`-prefixed emptiness).
 */
export function hashtagsFor(
  post: PostWithExtras,
  platform: SelectionPlatform
): string[] {
  if (platform === "facebook") return post.hashtags;
  if (platform === "instagram") {
    return post.variations.instagram?.hashtags ?? [];
  }
  return post.variations.linkedin?.hashtags ?? [];
}

/**
 * Tailwind aspect-ratio utility per network — used by the Phase 2
 * placeholder image rectangle so cards in different network previews
 * are shaped to match how each platform actually frames feed images.
 * Phase 3 image generation lands real bitmaps in these slots without
 * needing to revisit this mapping.
 *
 * Spec R8 defaults:
 *   - Facebook  → 1:1
 *   - Instagram → 1:1
 *   - LinkedIn  → 1.91:1
 */
export function aspectRatioFor(platform: SelectionPlatform): string {
  switch (platform) {
    case "facebook":
      return "aspect-square";
    case "instagram":
      return "aspect-square";
    case "linkedin":
      return "aspect-[1.91/1]";
  }
}

/**
 * Soft champagne pill showing the short network label. `title` attribute
 * carries the full network name for hover/screen-reader contexts where
 * "F" / "Insta" / "LI" would be opaque.
 */
export function NetworkBadge({ platform }: { platform: SelectionPlatform }) {
  return (
    <span
      className="bg-primary/15 text-primary border border-primary/30 rounded-full px-3 py-1 text-xs font-medium tracking-wide"
      title={NETWORK_LABELS[platform]}
    >
      {NETWORK_SHORT_LABELS[platform]}
    </span>
  );
}
