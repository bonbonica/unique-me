"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Loader2, X } from "lucide-react";
import {
  rescheduleAction,
  scheduleMyPickAction,
} from "@/app/(app)/(onboarded)/posts/actions";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 *   2. The Schedule button is placed UP TOP, right under the subhead, so
 *      a user who's already happy with their picks doesn't have to scroll
 *      past a long card grid to find the commit action. A second copy of
 *      the button sits at the bottom of the grid as a convenience for
 *      long lists.
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
}) {
  const isCancelled = mode === "cancelled";

  // Copy + action swap drives the only differences between reviewing and
  // cancelled-recoverable summary screens. Cards above the buttons render
  // identically.
  const headlineText = isCancelled
    ? "Re-schedule your week"
    : "Last step before your posts go live";
  const subheadText = isCancelled
    ? "Confirm to bring this batch back to scheduled."
    : "Confirm to schedule.";
  const ctaText = isCancelled ? "Schedule" : "Schedule my pick";
  const submittingText = "Scheduling…";
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One-time disclaimer popup fired at whole-batch scheduling completion
  // (the reviewing → scheduling OR cancelled → scheduling transition).
  // Opens once when the schedule/reschedule action returns ok; the
  // router.refresh() that flips the page to <LockedSummary /> is deferred
  // until the user dismisses the dialog. NOT per-post, NOT per checkbox
  // toggle — only at this one batch-level transition point.
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

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

  async function handleSchedule() {
    setSubmitting(true);
    setError(null);
    const result = isCancelled
      ? await rescheduleAction(batch.id)
      : await scheduleMyPickAction(batch.id);
    if (result.ok) {
      // batch.status flips to "scheduling" from either source state.
      // Show the one-time disclaimer; the router.refresh() that flips the
      // page to <LockedSummary /> happens on dismiss (handleDisclaimerClose
      // below). The success branch never falls through to a refresh
      // directly — the dialog is the gate.
      setDisclaimerOpen(true);
    } else {
      setError(scheduleErrorCopy(result.error));
      setSubmitting(false);
    }
  }

  // Single close handler covers all dismiss paths (the Got it button, Esc,
  // outside-click). Closes the dialog and only then refreshes — guarantees
  // the disclaimer is acknowledged once before the locked-summary view
  // renders.
  function handleDisclaimerClose(next: boolean) {
    if (next) return;
    setDisclaimerOpen(false);
    router.refresh();
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
          {headlineText}
        </h2>
        <p className="text-sm text-muted-foreground">{subheadText}</p>
      </header>

      {/* Primary commit placement — directly below the subhead so the
          action is visible without scrolling past the card grid. */}
      <div className="space-y-3">
        <ScheduleButton
          onClick={handleSchedule}
          disabled={submitting || isEmpty}
          submitting={submitting}
          label={ctaText}
          submittingLabel={submittingText}
        />
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {isEmpty ? (
          <p className="text-sm text-muted-foreground italic">
            Nothing to schedule yet. Go back to any network step to pick
            posts.
          </p>
        ) : null}
      </div>

      {!isEmpty ? (
        <>
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
              />
            ))}
          </ul>

          {/* Convenience copy at the bottom for long lists. Same handler
              as the top button — both share submitting/error state. */}
          <div className="flex justify-end border-t border-border pt-6">
            <ScheduleButton
              onClick={handleSchedule}
              disabled={submitting || isEmpty}
              submitting={submitting}
              label={ctaText}
              submittingLabel={submittingText}
            />
          </div>
        </>
      ) : null}

      {/* One-time disclaimer fired at whole-batch scheduling completion
          (the reviewing → scheduling OR cancelled → scheduling transition).
          Opens once when handleSchedule succeeds; dismissing it triggers
          the deferred router.refresh() that flips the page to
          <LockedSummary />. NOT per-post, NOT per checkbox toggle — only
          here at this one transition point. */}
      <Dialog open={disclaimerOpen} onOpenChange={handleDisclaimerClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
              Check your posts regularly
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-base leading-7 text-muted-foreground">
            Social media partners occasionally update their systems, which
            may affect automated publishing.
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => handleDisclaimerClose(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ScheduleButton({
  onClick,
  disabled,
  submitting,
  label,
  submittingLabel,
}: {
  onClick: () => void;
  disabled: boolean;
  submitting: boolean;
  label: string;
  submittingLabel: string;
}) {
  return (
    <Button
      type="button"
      size="lg"
      className="rounded-full glow-champagne self-start"
      onClick={onClick}
      disabled={disabled}
    >
      {submitting ? (
        <>
          <Loader2 className="animate-spin size-4 mr-2" aria-hidden />
          {submittingLabel}
        </>
      ) : (
        <>
          <CheckSquare className="size-4 mr-2" aria-hidden />
          {label}
        </>
      )}
    </Button>
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
}: {
  item: SummaryItem;
  batchCreatedAt: Date;
  totalPosts: number;
  dayWindow: number;
  postingDays: PostingDays;
  onRemove: () => void;
  image: PostImageStatus | undefined;
  onImageRetry?: ((postId: string) => void) | undefined;
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

function scheduleErrorCopy(err: string): string {
  switch (err) {
    case "no_selections":
      return "Pick at least one post-network combination first.";
    case "batch_already_locked":
      return "This batch is already scheduled or cancelled.";
    case "not_owned":
      return "You don't have access to this batch.";
    case "not_found":
      return "Batch not found.";
    case "db_failed":
      return "Couldn't save your selections. Try again.";
    default:
      return "Something went wrong. Try again.";
  }
}
