"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { regenerateImageAction } from "@/app/(app)/(onboarded)/posts/actions";
import { scheduleSinglePostAction } from "@/app/(app)/(onboarded)/schedule-posts/actions";
import { EditDialog } from "@/components/posts/edit-dialog";
import { aspectRatioFor } from "@/components/posts/network-preview";
import { PostTileImage } from "@/components/posts/post-tile-image";
import { Button } from "@/components/ui/button";
import type { UnscheduledPostRowData } from "@/lib/services/post-service";

/**
 * One row in a `/schedule-posts` tab: image (with Pro corner regenerate
 * for Pro users), scheduled date/time, full post text, and three
 * actions:
 *
 *   - **Schedule** (primary) — instantly creates the `post_selections`
 *     row for this `(postId, platform)`. The row vanishes from
 *     `/schedule-posts` and appears on `/posting-soon` on the next
 *     render. Auto-flips the batch to `'scheduling'` if it was still
 *     `'reviewing'` so the new selection surfaces immediately.
 *   - **Edit** — reuses the existing `<EditDialog>` from the wizard.
 *     Updates the canonical post text + hashtags. Variations stay as
 *     they were (same semantics as the wizard's per-step Edit).
 *   - **Regenerate image** (Pro only) — fired via the corner icon on
 *     `<PostTileImage>`. Calls `regenerateImageAction`; the page
 *     revalidates and the new image lands on next render. No client-
 *     side polling here — for a richer in-tab regenerate UX with live
 *     status updates the wizard remains the more featureful surface.
 */
export function UnscheduledPostRow({
  row,
  isPro,
}: {
  row: UnscheduledPostRowData;
  isPro: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleSchedule() {
    startTransition(async () => {
      const result = await scheduleSinglePostAction(row.postId, row.platform);
      if (!result.ok) {
        toast.error("Couldn't schedule this post.");
        return;
      }
      toast.success("Post scheduled.");
    });
  }

  function handleRegenerateImage(postId: string) {
    startTransition(async () => {
      const result = await regenerateImageAction(postId);
      if (!result.ok) {
        toast.error("Couldn't regenerate the image.");
        return;
      }
      toast.success("Regenerating image…");
    });
  }

  const dateLabel = formatScheduledTime(row.scheduledTime);
  const aspectClass = aspectRatioFor(row.platform);

  return (
    <article className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col sm:flex-row gap-6">
      <div className="shrink-0 w-32 sm:w-40">
        <PostTileImage
          image={row.image}
          aspectClass={aspectClass}
          alt={`Generated image for post ${row.post.postOrder}`}
          isPro={isPro}
          postId={row.postId}
          {...(isPro ? { onRegenerate: handleRegenerateImage } : {})}
        />
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        <p className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
          {dateLabel}
        </p>
        <p className="text-sm leading-7 whitespace-pre-wrap user-text">
          {row.text}
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            onClick={handleSchedule}
            disabled={pending}
          >
            {pending ? "Scheduling…" : "Schedule"}
          </Button>
          <EditDialog post={row.post} />
        </div>
      </div>
    </article>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "Mon Jun 23 · 9:00 AM" — short DOW, short month, locale-default time. */
function formatScheduledTime(d: Date): string {
  const dow = DOW[d.getDay()];
  const mon = MONTH[d.getMonth()];
  const dd = String(d.getDate()).padStart(2, "0");
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dow} ${mon} ${dd} · ${time}`;
}
