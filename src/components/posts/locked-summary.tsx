import Link from "next/link";
import { Calendar, Info } from "lucide-react";
import { DayLabel } from "@/components/posts/day-label";
import {
  aspectRatioFor,
  hashtagsFor,
  NETWORK_ORDER_INDEX,
  NetworkBadge,
  type PostWithExtras,
  textFor,
} from "@/components/posts/network-preview";
import { PostTileImage } from "@/components/posts/post-tile-image";
import { MAX_BATCHES_PER_PERIOD } from "@/lib/pricing";
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
 * Post-commit / cancelled view (Wave 5 polish). Same large-card layout as
 * the wizard summary so the visual flow from review → schedule → locked
 * feels like one continuous screen — the cards just lose their per-item
 * controls.
 *
 * Status branches:
 *   - `"scheduling"` — batch is locked but real times haven't been
 *     assigned yet (Phase 4 calendar UI will do that). Each card carries
 *     a "Scheduled for: to be assigned" date slot in place of where
 *     Phase 4 will inject the real timestamp.
 *   - `"cancelled"`  — same cards, same date slot (read as historical
 *     record), plus a "Start a new batch" banner at the top.
 *
 * Per-card controls are intentionally empty (no Edit / Remove /
 * Regenerate). Edit on a locked batch would land service-layer
 * `batch_locked`; surfacing the button would be a UX trap. The screen
 * is for confirmation viewing, not mutation.
 *
 * No Stop / Cancel-batch button: per-post unschedule + delete live on
 * `/posting-soon`. The underlying `postService.stopBatch` service still
 * exists for any future programmatic caller; this surface just doesn't
 * expose it as a button.
 */

/**
 * Heading for the live posting view (D-S2-17 follow-up). Pro batches carry
 * `batchOrdinalInPeriod` 1..MAX_BATCHES_PER_PERIOD so the heading surfaces
 * which slot in the current Pro period is mid-posting — the same number
 * `<UnscheduledBatchCard />` and `<ScheduledBatchBox />` show in their strip
 * labels, so the user can trace a batch from `/create` or `/schedule` to
 * the locked view and see the matching ordinal.
 *
 * Trial / Starter batches have `batchOrdinalInPeriod === null` (those plans
 * use lifetime / weekly caps, not a Pro-style 4-per-period ordinal). When
 * null we omit the suffix entirely rather than rendering `Batch null/4`.
 */
function currentlyPostingHeading(ordinal: number | null): string {
  const base = "Currently posting on your social media";
  if (ordinal === null) return base;
  return `${base} · Batch ${ordinal}/${MAX_BATCHES_PER_PERIOD}`;
}

/**
 * "Day N" terminology in the scheduled-for slot encodes the rolling 7-day
 * scheduling-window design (item 5 in the post-Wave-5 polish brief):
 *
 *  - The database stores universal day labels via `posts.postOrder`
 *    (1..`batch.totalPosts` — 7 for Free/Pro batches 1-3, 9 for Pro
 *    batch 4). No date is committed at batch-creation time.
 *  - Phase 4's cron + scheduling layer will assign a `scheduledTime` per
 *    post. Day 1 is anchored to the day the first post actually publishes
 *    in the user's local timezone — NOT the day the batch was generated.
 *  - At display time, the user-visible weekday + date are computed from
 *    the browser's timezone at the moment of render. This file's "Day N"
 *    label is the placeholder Phase 4 swaps for the real timestamp.
 *  - After Day 7 ends in the user's local timezone the batch closes
 *    permanently — also Phase 4 territory (auto-close cron + status flip).
 *
 * For Phase 2 we only need the slot to exist with a sensible holding
 * label so Phase 4 can drop in the real value without UI churn.
 */
const SCHEDULED_TIME_PLACEHOLDER = "scheduled time pending";

type SummaryItem = {
  post: PostWithExtras;
  platform: SelectionPlatform;
};

export function LockedSummary({ data }: { data: BatchForReview }) {
  const isCancelled = data.batch.status === "cancelled";

  // All selections that exist in the persisted state. Unlike the wizard
  // summary, we don't filter by `data.platforms` here — a cancelled batch
  // may carry selections for platforms the user has since removed from
  // their profile, and the historical record is more honest than hiding
  // them.
  const items: SummaryItem[] = [];
  for (const post of data.posts) {
    for (const platform of post.selections) {
      items.push({ post, platform });
    }
  }
  items.sort((a, b) => {
    if (a.post.postOrder !== b.post.postOrder) {
      return a.post.postOrder - b.post.postOrder;
    }
    return NETWORK_ORDER_INDEX[a.platform] - NETWORK_ORDER_INDEX[b.platform];
  });

  const isEmpty = items.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {isCancelled
            ? "Batch cancelled"
            : currentlyPostingHeading(data.batch.batchOrdinalInPeriod)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isCancelled
            ? "This batch was cancelled. Nothing was posted."
            : "Your selections are locked."}
        </p>
      </header>

      {/* Persistent informational notice on the currently-posting view.
          Renders only for non-cancelled batches (the cancelled state has its
          own "Batch cancelled" header + Start-a-new-batch block below; the
          regular-publishing reminder doesn't apply there). Calm
          muted-surface treatment per DESIGN.md §3 — bg-muted/50 + border,
          Info icon in muted-foreground, body text in muted-foreground.
          Not destructive, not primary-tinted. */}
      {!isCancelled ? (
        <div
          role="note"
          className="rounded-2xl border border-border bg-muted/50 px-5 py-4 flex items-start gap-3"
        >
          <Info
            className="size-4 text-muted-foreground shrink-0 mt-1"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground leading-6">
            Check your posts regularly. Social media partners occasionally
            update their systems, which may affect automated publishing.
          </p>
        </div>
      ) : null}

      {isCancelled ? (
        <div className="rounded-2xl border border-border bg-muted px-6 py-4 text-sm">
          <Link
            href="/create"
            className="text-primary hover:underline underline-offset-4"
          >
            Start a new batch →
          </Link>
        </div>
      ) : null}

      {isEmpty ? (
        <p className="text-sm text-muted-foreground italic">
          No posts were selected.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <LockedCard
              key={`${item.post.id}:${item.platform}`}
              item={item}
              batchCreatedAt={data.batch.createdAt}
              totalPosts={data.batch.totalPosts}
              dayWindow={dayWindowOrFallback(data.batch)}
              postingDays={postingDaysOrFallback(data.batch)}
              image={data.images[item.post.id]}
            />
          ))}
        </ul>
      )}

    </div>
  );
}

/**
 * Locked variant of the per-network card. Same shell + image placeholder
 * + caption layout as wizard-summary's `SummaryCard`, minus all per-item
 * controls. Adds a Phase-4-shaped "Scheduled for" line so the calendar
 * step has a slot to populate without revisiting the card layout.
 */
function LockedCard({
  item,
  batchCreatedAt,
  totalPosts,
  dayWindow,
  postingDays,
  image,
}: {
  item: SummaryItem;
  batchCreatedAt: Date;
  totalPosts: number;
  dayWindow: number;
  postingDays: PostingDays;
  /**
   * Image-generation Wave 1 Stage 5: per-post image status. By the time
   * a batch reaches `scheduling`, images should be terminal (success or
   * failed) — `<LockedSummary />` deliberately does NOT poll. The card
   * just renders whatever state is in the SSR snapshot.
   */
  image: PostImageStatus | undefined;
}) {
  const { post, platform } = item;
  const text = textFor(post, platform);
  const hashtags = hashtagsFor(post, platform);
  const aspectClass = aspectRatioFor(platform);

  return (
    <li className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col gap-4 opacity-90">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Post {post.postOrder} / {totalPosts}
        </span>
        <NetworkBadge platform={platform} />
      </div>

      <PostTileImage
        image={image}
        aspectClass={aspectClass}
        alt={`Generated image for post ${post.postOrder}`}
      />

      {/* Phase-4 date slot. `<DayLabel />` resolves the weekday in the
          user's browser timezone (Phase 3 spec D8) via the same
          filtered-offsets list `resolveBatchPlan` produces. The trailing
          "scheduled time pending" is the Phase-2 holding copy; Phase 4
          will swap it for the real time once the calendar / cron lands. */}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Calendar className="size-3.5 shrink-0" aria-hidden />
        <span>
          <DayLabel
            postOrder={post.postOrder}
            batchCreatedAt={batchCreatedAt}
            dayWindow={dayWindow}
            postingDays={postingDays}
          />{" "}
          — {SCHEDULED_TIME_PLACEHOLDER}
        </span>
      </p>

      <div className="space-y-2 flex-1 user-text">
        <p className="text-sm leading-7 whitespace-pre-wrap">{text}</p>
        {hashtags.length > 0 ? (
          <p className="text-xs text-primary leading-6 break-words">
            {hashtags.map((h) => `#${h}`).join(" ")}
          </p>
        ) : null}
      </div>
    </li>
  );
}

