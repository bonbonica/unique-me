"use client";

import { X } from "lucide-react";
import { DayLabel } from "@/components/posts/day-label";
import { EditDialog } from "@/components/posts/edit-dialog";
import {
  aspectRatioFor,
  hashtagsFor,
  NETWORK_LABELS,
  NETWORK_ORDER_INDEX,
  NetworkBadge,
  type PostWithExtras,
  textFor,
} from "@/components/posts/network-preview";
import { PostTileImage } from "@/components/posts/post-tile-image";
import { Button } from "@/components/ui/button";
import {
  dayWindowOrFallback,
  postingDaysOrFallback,
} from "@/lib/scheduling/batch-calendar";
import type { PostingDays, SelectionPlatform } from "@/lib/schema";
import type {
  BatchForReview,
  PostImageStatus,
} from "@/lib/services/post-service";

/**
 * Final wizard step — the commit page.
 *
 * Layout intent:
 *   1. Headline + subhead make it unambiguous this is the
 *      point-of-no-return ("Last step before your posts go live. Confirm
 *      to schedule.").
 *   2. The Schedule button is rendered by {@link NetworkWizard} in the
 *      top-right slot of the surrounding {@link WizardNav} — the same
 *      position Next occupies on steps 1..N-1. This component is now
 *      pure presentation of the selected cards; it owns no schedule
 *      state.
 *   3. Selection items render as full cards matching the per-network step
 *      style (rounded-2xl, p-6, shadow-soft, same aspect-ratio image
 *      placeholder, same caption + hashtag layout). They feel like the
 *      same component the user saw at each network step — now in
 *      summary mode with a remove control instead of a checkbox.
 *
 * Per-card controls:
 *   - Network short-badge: "F" / "Insta" / "LI" in the champagne accent.
 *   - Edit: the same EditDialog used on per-network steps. Edits update
 *     the canonical post; variations stay stale (their stale note is
 *     only shown on network steps where it's actionable).
 *   - Remove: removes that (post, network) pair from selections. NO
 *     Regenerate here — the 1× cap is enforced at the per-network step;
 *     summary is final review, not re-rolling.
 *
 * Selection state is owned by {@link NetworkWizard}. Both initial render
 * AND per-item removal go through the parent's `onSetSelection` callback,
 * so the back-buttons throughout the wizard see the same view of the
 * world.
 */

type SelectionsByPlatform = Record<SelectionPlatform, string[]>;

type SummaryItem = {
  post: PostWithExtras;
  platform: SelectionPlatform;
};

export function WizardSummary({
  batch,
  posts,
  platforms,
  selections,
  onSetSelection,
  mode,
  images,
  onImageRetry,
  isPro,
  onImageRegenerate,
}: {
  batch: BatchForReview["batch"];
  posts: BatchForReview["posts"];
  platforms: BatchForReview["platforms"];
  selections: SelectionsByPlatform;
  onSetSelection: (
    postId: string,
    platform: SelectionPlatform,
    next: boolean
  ) => void;
  mode: "reviewing" | "cancelled";
  /**
   * Image-generation Wave 1 Stage 5: per-post image status map. Same
   * shape and source as on `<WizardStep />`; threaded through to
   * `<SummaryCard />` by post id.
   */
  images: Record<string, PostImageStatus>;
  /**
   * Image-generation Wave 2 Stage 3: retry callback fired by the tile's
   * "Try again" button on a failed image. Threaded through to SummaryCard
   * → PostTileImage as the `onRetry` prop.
   */
  onImageRetry?: ((postId: string) => void) | undefined;
  /**
   * Image-generation Wave 2 Stage 4: server-resolved Pro flag. Threaded
   * through to PostTileImage so the corner regenerate icon shows only
   * for Pro+active users. Server action gates regardless.
   */
  isPro: boolean;
  /**
   * Image-generation Wave 2 Stage 4: regenerate callback fired by the
   * Pro corner icon on a successful image. Threaded through as
   * `onRegenerate` on PostTileImage.
   */
  onImageRegenerate?: ((postId: string) => void) | undefined;
}) {
  const isCancelled = mode === "cancelled";

  // Copy swap drives the only difference between reviewing and
  // cancelled-recoverable summary screens. Cards render identically.
  const headlineText = isCancelled
    ? "Re-schedule your week"
    : "Last step before your posts go live";
  const subheadText = isCancelled
    ? "Confirm to bring this batch back to scheduled."
    : "Confirm to schedule.";

  // Flatten lifted selections into a flat list of (post, platform) pairs.
  // Filtered to platforms in profile.platforms so a leftover row from a
  // platform the user has since deselected in onboarding can't surface.
  // Sorted by postOrder then by canonical platform order so adjacent
  // rows for the same post stay grouped.
  const items: SummaryItem[] = [];
  for (const post of posts) {
    for (const platform of platforms) {
      if (selections[platform].includes(post.id)) {
        items.push({ post, platform });
      }
    }
  }
  items.sort((a, b) => {
    if (a.post.postOrder !== b.post.postOrder) {
      return a.post.postOrder - b.post.postOrder;
    }
    return NETWORK_ORDER_INDEX[a.platform] - NETWORK_ORDER_INDEX[b.platform];
  });

  const isEmpty = items.length === 0;

  function handleRemove(item: SummaryItem) {
    onSetSelection(item.post.id, item.platform, false);
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
          {headlineText}
        </h2>
        <p className="text-sm text-muted-foreground">{subheadText}</p>
      </header>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground italic">
          Nothing to schedule yet. Go back to any network step to pick
          posts.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <SummaryCard
              key={`${item.post.id}:${item.platform}`}
              item={item}
              batchCreatedAt={batch.createdAt}
              totalPosts={batch.totalPosts}
              dayWindow={dayWindowOrFallback(batch)}
              postingDays={postingDaysOrFallback(batch)}
              onRemove={() => handleRemove(item)}
              image={images[item.post.id]}
              onImageRetry={onImageRetry}
              isPro={isPro}
              onImageRegenerate={onImageRegenerate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryCard({
  item,
  batchCreatedAt,
  totalPosts,
  dayWindow,
  postingDays,
  onRemove,
  image,
  onImageRetry,
  isPro,
  onImageRegenerate,
}: {
  item: SummaryItem;
  batchCreatedAt: Date;
  totalPosts: number;
  dayWindow: number;
  postingDays: PostingDays;
  onRemove: () => void;
  image: PostImageStatus | undefined;
  onImageRetry?: ((postId: string) => void) | undefined;
  isPro: boolean;
  onImageRegenerate?: ((postId: string) => void) | undefined;
}) {
  const { post, platform } = item;
  const text = textFor(post, platform);
  const hashtags = hashtagsFor(post, platform);
  const aspectClass = aspectRatioFor(platform);

  return (
    <li className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col gap-4 card-interactive">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Post {post.postOrder} / {totalPosts}
        </span>
        <DayLabel
          postOrder={post.postOrder}
          batchCreatedAt={batchCreatedAt}
          dayWindow={dayWindow}
          postingDays={postingDays}
        />
        <NetworkBadge platform={platform} />
      </div>

      <PostTileImage
        image={image}
        aspectClass={aspectClass}
        alt={`Generated image for post ${post.postOrder}`}
        onRetry={onImageRetry}
        postId={item.post.id}
        isPro={isPro}
        onRegenerate={onImageRegenerate}
      />

      <div className="space-y-2 flex-1 user-text">
        <p className="text-sm leading-7 whitespace-pre-wrap">{text}</p>
        {hashtags.length > 0 ? (
          <p className="text-xs text-primary leading-6 break-words">
            {hashtags.map((h) => `#${h}`).join(" ")}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <EditDialog post={post} />
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={onRemove}
          aria-label={`Remove Post ${post.postOrder} from ${NETWORK_LABELS[platform]}`}
        >
          <X className="size-4" aria-hidden />
          Remove
        </Button>
      </div>
    </li>
  );
}
