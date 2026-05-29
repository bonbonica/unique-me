"use client";

import type { ReactNode } from "react";
import { CheckSquare, Facebook, Instagram, Linkedin } from "lucide-react";
import { EditDialog } from "@/components/posts/edit-dialog";
import {
  aspectRatioFor,
  hashtagsFor,
  NETWORK_LABELS,
  type PostWithExtras,
  textFor,
} from "@/components/posts/network-preview";
import { RegenerateDialog } from "@/components/posts/regenerate-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { SelectionPlatform } from "@/lib/schema";
import type { BatchForReview } from "@/lib/services/post-service";

/**
 * Per-network step. Renders 7 cards in this platform's preview format
 * and a state-driven bulk-schedule button above them.
 *
 * Selection state is owned by the parent {@link NetworkWizard} (see its
 * top-of-file rationale). This component is purely presentational — it
 * reads from `selections` for each card's checked state and per-step
 * count, and calls the parent's `onSetSelection` /
 * `onSelectAllForPlatform` / `onAdvance` callbacks for user actions.
 *
 * Bulk-button behavior (the user-spec for this step):
 *   - 0 selected   → label "Schedule all {Network} posts" → bulk-select
 *                    all 7 on the client (server catches up via
 *                    onSelectAllForPlatform) AND advance to the next step.
 *   - 1-6 selected → label "Schedule my pick" → just advance (current
 *                    selections persist).
 *   - 7 selected   → label "Schedule all {Network} posts" → just advance
 *                    (no select-all needed; everything is already in).
 *
 * The button does NOT commit the batch. Committing happens once, on the
 * summary step. The wording on this button is intentionally aspirational
 * ("Schedule…") because it represents the user's intent to send these
 * to summary — even though the final go/no-go is one more click away.
 */

const NETWORK_ICON: Record<SelectionPlatform, ReactNode> = {
  facebook: (
    <Facebook className="size-4 text-muted-foreground" aria-label="Facebook" />
  ),
  instagram: (
    <Instagram
      className="size-4 text-muted-foreground"
      aria-label="Instagram"
    />
  ),
  linkedin: (
    <Linkedin className="size-4 text-muted-foreground" aria-label="LinkedIn" />
  ),
};

type SelectionsByPlatform = Record<SelectionPlatform, string[]>;

export function WizardStep({
  platform,
  posts,
  selections,
  onSetSelection,
  onSelectAllForPlatform,
  onAdvance,
}: {
  platform: SelectionPlatform;
  posts: BatchForReview["posts"];
  batchTheme: string;
  selections: SelectionsByPlatform;
  onSetSelection: (
    postId: string,
    platform: SelectionPlatform,
    next: boolean
  ) => void;
  onSelectAllForPlatform: (platform: SelectionPlatform) => void;
  onAdvance: () => void;
}) {
  const selectedIds = selections[platform];
  const selectedCount = selectedIds.length;
  const totalPosts = posts.length;
  const isAllOrNone =
    selectedCount === 0 || selectedCount === totalPosts;

  const bulkLabel = isAllOrNone
    ? `Schedule all ${NETWORK_LABELS[platform]} posts`
    : "Schedule my pick";

  function handleBulkClick() {
    // 0 → flip all 7 on, then advance.
    // 1-6 → just advance (label says "Schedule my pick").
    // 7 → just advance (everything is already selected).
    if (selectedCount === 0) {
      onSelectAllForPlatform(platform);
    }
    onAdvance();
  }

  return (
    <section className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
              Review for {NETWORK_LABELS[platform]}
            </h2>
            <p className="text-sm text-muted-foreground">
              Check the posts you want to publish on{" "}
              {NETWORK_LABELS[platform]}. You can come back to any step.
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            className="rounded-full gap-2"
            onClick={handleBulkClick}
          >
            <CheckSquare className="size-4" aria-hidden />
            {bulkLabel}
          </Button>
        </div>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            platform={platform}
            isSelected={selectedIds.includes(post.id)}
            onToggle={(next) => onSetSelection(post.id, platform, next)}
          />
        ))}
      </ul>
    </section>
  );
}

function PostCard({
  post,
  platform,
  isSelected,
  onToggle,
}: {
  post: PostWithExtras;
  platform: SelectionPlatform;
  isSelected: boolean;
  onToggle: (next: boolean) => void;
}) {
  const text = textFor(post, platform);
  const hashtags = hashtagsFor(post, platform);
  const aspectClass = aspectRatioFor(platform);
  const stale = isVariationStale(post, platform);
  const canRegen = post.regenerationCount < 1;

  return (
    <li className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col gap-4 card-interactive">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Post {post.postOrder} / 7
        </span>
        {NETWORK_ICON[platform]}
      </div>

      {/* Phase 3 will replace this placeholder rectangle with the real
          image (one base image per post, resized client-side or by the
          posting service per network — see spec D12). */}
      <div
        className={`bg-muted rounded-lg ${aspectClass} flex items-center justify-center text-xs text-muted-foreground`}
        aria-hidden
      >
        Image — Phase 3
      </div>

      <div className="space-y-2 flex-1">
        <p className="text-sm leading-7 whitespace-pre-wrap">{text}</p>
        {hashtags.length > 0 ? (
          <p className="text-xs text-primary leading-6 break-words">
            {hashtags.map((h) => `#${h}`).join(" ")}
          </p>
        ) : null}
        {stale ? (
          <StaleVariationNote canRegen={canRegen} platform={platform} />
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        Schedule this to {NETWORK_LABELS[platform]}?
      </label>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <EditDialog post={post} />
        <RegenerateDialog
          post={post}
          disabled={!canRegen}
          disabledTooltip="You've already regenerated this post."
        />
      </div>
    </li>
  );
}

function isVariationStale(
  post: PostWithExtras,
  platform: SelectionPlatform
): boolean {
  if (platform === "facebook") return false;
  if (post.status !== "edited") return false;
  const variation =
    platform === "instagram"
      ? post.variations.instagram
      : post.variations.linkedin;
  if (!variation) return false;
  return variation.createdAt < post.updatedAt;
}

function StaleVariationNote({
  canRegen,
  platform,
}: {
  canRegen: boolean;
  platform: SelectionPlatform;
}) {
  const action = canRegen
    ? "Regenerate (1 left) to refresh both."
    : "Edit this post to update both.";
  return (
    <p className="text-xs italic text-muted-foreground">
      You edited this post on the Facebook step — the{" "}
      {NETWORK_LABELS[platform]} version may be older. {action}
    </p>
  );
}
