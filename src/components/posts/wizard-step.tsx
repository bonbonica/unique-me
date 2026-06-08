"use client";

import type { ReactNode } from "react";
import { CheckSquare, Facebook, Instagram, Linkedin } from "lucide-react";
import { DayLabel } from "@/components/posts/day-label";
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
import { cn } from "@/lib/utils";

/**
 * Per-network step. Renders one card per post in this platform's preview
 * format (the batch's `totalPosts` — 7 for Free/Pro batches 1-3, 9 for Pro
 * batch 4) and a state-driven bulk-schedule button above them.
 *
 * Selection state is owned by the parent {@link NetworkWizard} (see its
 * top-of-file rationale). This component is purely presentational — it
 * reads from `selections` for each card's checked state and per-step
 * count, and calls the parent's `onSetSelection` /
 * `onSelectAllForPlatform` / `onDeselectAllForPlatform` callbacks for
 * user actions.
 *
 * Bulk-button behavior (the user-spec for this step):
 *   - 0 selected           → label "Schedule all {Network} posts" →
 *                            bulk-select all N on the client (server
 *                            catches up via onSelectAllForPlatform).
 *   - 1 .. N-1 selected    → label "Schedule remaining {N-selected}
 *                            {Network} posts" → bulk-selects every
 *                            post on the platform, idempotently. The
 *                            already-selected rows hit
 *                            `ON CONFLICT DO NOTHING` in the service
 *                            so no duplicate `post_selections` rows are
 *                            created (post-service.ts:1051-1053 +
 *                            schema unique index).
 *   - all N selected       → label "N {Network} posts scheduled" →
 *                            deselects all N (undo).
 *
 * The button never advances the wizard — the user moves between steps
 * only via the WizardNav Back/Next buttons. It also does NOT commit the
 * batch; committing happens once, on the summary step.
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
  batchCreatedAt,
  selections,
  onSetSelection,
  onSelectAllForPlatform,
  onDeselectAllForPlatform,
  mode,
}: {
  platform: SelectionPlatform;
  posts: BatchForReview["posts"];
  batchTheme: string;
  batchCreatedAt: Date;
  selections: SelectionsByPlatform;
  onSetSelection: (
    postId: string,
    platform: SelectionPlatform,
    next: boolean
  ) => void;
  onSelectAllForPlatform: (platform: SelectionPlatform) => void;
  onDeselectAllForPlatform: (platform: SelectionPlatform) => void;
  mode: "reviewing" | "cancelled";
}) {
  const selectedIds = selections[platform];
  const selectedCount = selectedIds.length;
  const totalPosts = posts.length;
  const isAllSelected =
    selectedCount === totalPosts && totalPosts > 0;

  /**
   * Three-state bulk-action button driven by the live selection count
   * (N = `totalPosts`, the batch's `totalPosts` column — 7 or 9):
   *
   *   - **0 selected** — label "Schedule all {Network} posts". Click
   *     selects all N. Icon inherits button color.
   *   - **1 .. N-1 selected** — label "Schedule remaining {N-selected}
   *     {Network} posts". Click bulk-selects every post on the platform
   *     idempotently — the already-selected rows are skipped server-side
   *     via `selectForNetwork`'s `ON CONFLICT DO NOTHING` on the
   *     `(postId, platform)` unique index, so the click never creates
   *     duplicate rows and never errors. The already-scheduled posts
   *     remain untouched; only the unscheduled ones get inserted.
   *   - **all N selected** — label "N {Network} posts scheduled". Icon
   *     flips to destructive (#dc3030) signalling "all in — click to
   *     undo." Click DESELECTS all N.
   *
   * The button never advances the wizard. Step navigation happens only
   * via the WizardNav Back/Next buttons.
   */
  const remainingCount = totalPosts - selectedCount;
  let bulkLabel: string;
  if (selectedCount === 0) {
    bulkLabel = `Schedule all ${NETWORK_LABELS[platform]} posts`;
  } else if (isAllSelected) {
    bulkLabel = `${selectedCount} ${NETWORK_LABELS[platform]} ${selectedCount === 1 ? "post" : "posts"} scheduled`;
  } else {
    bulkLabel = `Schedule remaining ${remainingCount} ${NETWORK_LABELS[platform]} ${remainingCount === 1 ? "post" : "posts"}`;
  }

  function handleBulkClick() {
    if (isAllSelected) {
      // Full set already scheduled → click is the undo affordance.
      onDeselectAllForPlatform(platform);
      return;
    }
    // 0 or middle range: "make sure all are scheduled." The platform
    // helper fans `selectForNetworkAction` across every post in parallel
    // (network-wizard.tsx); the service uses `ON CONFLICT DO NOTHING` on
    // the `(postId, platform)` unique index so already-scheduled posts
    // are silently skipped — no duplicates, no error.
    onSelectAllForPlatform(platform);
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
            className={cn(
              "rounded-full gap-2",
              selectedCount > 0 &&
                "bg-[#bd955c] hover:bg-[#bd955c] dark:bg-primary dark:hover:bg-primary/90"
            )}
            onClick={handleBulkClick}
            aria-label={
              isAllSelected
                ? `${selectedCount} ${NETWORK_LABELS[platform]} posts scheduled — click to deselect all`
                : bulkLabel
            }
          >
            <CheckSquare
              className={`size-4 ${isAllSelected ? "text-[#dc3030]" : ""}`}
              aria-hidden
            />
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
            batchCreatedAt={batchCreatedAt}
            totalPosts={totalPosts}
            isSelected={selectedIds.includes(post.id)}
            onToggle={(next) => onSetSelection(post.id, platform, next)}
            mode={mode}
          />
        ))}
      </ul>
    </section>
  );
}

function PostCard({
  post,
  platform,
  batchCreatedAt,
  totalPosts,
  isSelected,
  onToggle,
  mode,
}: {
  post: PostWithExtras;
  platform: SelectionPlatform;
  batchCreatedAt: Date;
  totalPosts: number;
  isSelected: boolean;
  onToggle: (next: boolean) => void;
  mode: "reviewing" | "cancelled";
}) {
  const text = textFor(post, platform);
  const hashtags = hashtagsFor(post, platform);
  const aspectClass = aspectRatioFor(platform);
  const stale = isVariationStale(post, platform);
  const canRegen = post.regenerationCount < 1;

  return (
    <li className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col gap-4 card-interactive">
      {/* Top-right "Schedule this to {Network}?" toggle (moved from the
          bottom of the card so the schedule affordance sits in the
          conventional corner-action position users scan for). Behavior
          is unchanged from the previous bottom-anchored placement. */}
      <label className="self-end flex items-center gap-2 text-sm cursor-pointer select-none">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggle(checked === true)}
        />
        Schedule this to {NETWORK_LABELS[platform]}?
      </label>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Post {post.postOrder} / {totalPosts}
        </span>
        <DayLabel
          postOrder={post.postOrder}
          batchCreatedAt={batchCreatedAt}
        />
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

      <div className="space-y-2 flex-1 user-text">
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

      <div
        className={`flex items-center ${mode === "cancelled" ? "justify-start" : "justify-between"} border-t border-border pt-4`}
      >
        <EditDialog post={post} />
        {/* Regenerate is hidden entirely in cancelled-recoverable mode
            (no AI text re-rolls during recovery — Item 6 spec). The 1×
            cap may have already been spent during the reviewing phase,
            or unused; either way the action isn't available here. */}
        {mode === "reviewing" ? (
          <RegenerateDialog
            post={post}
            disabled={!canRegen}
            disabledTooltip="You've already regenerated this post."
          />
        ) : null}
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
