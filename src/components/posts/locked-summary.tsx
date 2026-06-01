"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Loader2 } from "lucide-react";
import { stopBatchAction } from "@/app/(app)/(onboarded)/posts/actions";
import { DayLabel } from "@/components/posts/day-label";
import {
  aspectRatioFor,
  hashtagsFor,
  NETWORK_ORDER_INDEX,
  NetworkBadge,
  type PostWithExtras,
  textFor,
} from "@/components/posts/network-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SelectionPlatform } from "@/lib/schema";
import type { BatchForReview } from "@/lib/services/post-service";

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
 *     Phase 4 will inject the real timestamp. Stop button at the bottom.
 *   - `"cancelled"`  — same cards, same date slot (read as historical
 *     record), plus a "Start a new batch" banner at the top. No Stop
 *     button — there's nothing to stop.
 *
 * Per-card controls are intentionally empty (no Edit / Remove /
 * Regenerate). Edit on a locked batch would land service-layer
 * `batch_locked`; surfacing the button would be a UX trap. The screen
 * is for confirmation viewing, not mutation.
 *
 * The Stop button keeps its current bottom-of-page placement (deliberate
 * — the destructive distance-to-click is a feature, not a bug).
 */

/**
 * "Day N" terminology in the scheduled-for slot encodes the rolling 7-day
 * scheduling-window design (item 5 in the post-Wave-5 polish brief):
 *
 *  - The database stores universal day labels via `posts.postOrder` (1-7).
 *    No date is committed at batch-creation time.
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
  const isScheduling = data.batch.status === "scheduling";

  // Shared dialog state for the stop-batch flow. Lifted out of
  // <StopBatchDialog /> so both the top-of-header trigger and the
  // bottom-of-page trigger flip the same `open` flag and call the
  // same confirm handler — one dialog instance, one source of truth.
  const [stopOpen, setStopOpen] = useState(false);

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
      <header
        className={
          isScheduling
            ? "flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4"
            : "space-y-2"
        }
      >
        <div className="space-y-2 flex-1">
          <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
            {isCancelled
              ? "Batch cancelled"
              : "Your scheduled posts are here"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isCancelled
              ? "This batch was cancelled. Nothing was posted."
              : "Your selections are locked. Stopping will cancel the batch."}
          </p>
        </div>
        {isScheduling ? (
          <Button
            variant="destructive"
            className="rounded-lg self-start sm:self-auto"
            onClick={() => setStopOpen(true)}
          >
            Stop entire batch
          </Button>
        ) : null}
      </header>

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
            />
          ))}
        </ul>
      )}

      {isScheduling ? (
        <div className="border-t border-border pt-6">
          <Button
            variant="destructive"
            className="rounded-lg"
            onClick={() => setStopOpen(true)}
          >
            Stop entire batch
          </Button>
          <StopBatchDialog
            batchId={data.batch.id}
            open={stopOpen}
            onOpenChange={setStopOpen}
          />
        </div>
      ) : null}
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
}: {
  item: SummaryItem;
  batchCreatedAt: Date;
}) {
  const { post, platform } = item;
  const text = textFor(post, platform);
  const hashtags = hashtagsFor(post, platform);
  const aspectClass = aspectRatioFor(platform);

  return (
    <li className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col gap-4 opacity-90">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Post {post.postOrder} / 7
        </span>
        <NetworkBadge platform={platform} />
      </div>

      <div
        className={`bg-muted rounded-lg ${aspectClass} flex items-center justify-center text-xs text-muted-foreground`}
        aria-hidden
      >
        Image — Phase 3
      </div>

      {/* Phase-4 date slot. `<DayLabel />` resolves the weekday in the
          user's browser timezone (Phase 3 spec D8). The trailing
          "scheduled time pending" is the Phase-2 holding copy; Phase 4
          will swap it for the real time once the calendar / cron lands. */}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Calendar className="size-3.5 shrink-0" aria-hidden />
        <span>
          <DayLabel
            postOrder={post.postOrder}
            batchCreatedAt={batchCreatedAt}
          />{" "}
          — {SCHEDULED_TIME_PLACEHOLDER}
        </span>
      </p>

      <div className="space-y-2 flex-1">
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

/**
 * Confirmation Dialog for the stop-batch flow. Two-step interaction
 * (button → dialog → "Yes, stop it") makes cancellation deliberate.
 * Server-side, {@link stopBatchAction} only succeeds when the batch is
 * currently in `"scheduling"` — the SQL guard prevents double-stops or
 * stops after Phase 4 transitions the batch to `"scheduled"`.
 *
 * Controlled component: `open` is owned by {@link LockedSummary} so the
 * top-of-header and bottom-of-page triggers can share one dialog
 * instance. `submitting` and `error` remain internal — they belong to
 * the confirm flow itself.
 */
function StopBatchDialog({
  batchId,
  open,
  onOpenChange,
}: {
  batchId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    const result = await stopBatchAction(batchId);
    if (result.ok) {
      onOpenChange(false);
      // After a successful stop the page re-renders into the cancelled
      // view (header copy changes, cancelled banner appears). Jumping
      // instantly to the top lets the user land at the new top cleanly
      // — a smooth scroll while the route segment refreshes feels choppy.
      window.scrollTo({ top: 0, behavior: "instant" });
      router.refresh();
    } else {
      setError(stopErrorCopy(result.error));
      setSubmitting(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop entire batch?</DialogTitle>
          <DialogDescription>
            This cancels the batch. Nothing posts to any network. You
            can&apos;t undo this.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Never mind
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin size-4 mr-2" aria-hidden />
                Cancelling…
              </>
            ) : (
              "Yes, stop it"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stopErrorCopy(err: string): string {
  switch (err) {
    case "not_scheduling":
      return "This batch isn't in a state that can be stopped.";
    case "not_owned":
      return "You don't have access to this batch.";
    case "not_found":
      return "Batch not found.";
    case "db_failed":
      return "Couldn't cancel the batch. Try again.";
    default:
      return "Something went wrong.";
  }
}
