"use client";

import { useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  deletePostAction,
  unschedulePostAction,
} from "@/app/(app)/(onboarded)/posting-soon/actions";
import { Button } from "@/components/ui/button";
import type { ScheduledPostRowData } from "@/lib/services/post-service";

/**
 * One row in a `/posting-soon` tab: image thumbnail, scheduled date/time,
 * full post text, and two action buttons.
 *
 *   - **Unschedule** removes this `(postId, platform)` row from
 *     `post_selections`. The post stays in the batch (other networks'
 *     selections, if any, are untouched).
 *   - **Delete** removes the post entirely (cascades across
 *     scheduled_posts → post_selections → post_variations → post_images).
 *     The image is moved to the user's library first.
 *
 * Both actions revalidate the page server-side; the row disappears on
 * the next render.
 */
export function ScheduledPostRow({ row }: { row: ScheduledPostRowData }) {
  const [unschedulePending, startUnscheduleTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();

  function handleUnschedule() {
    startUnscheduleTransition(async () => {
      const result = await unschedulePostAction(row.postId, row.platform);
      if (!result.ok) {
        toast.error("Couldn't unschedule this post.");
        return;
      }
      toast.success("Post unscheduled.");
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deletePostAction(row.postId);
      if (!result.ok) {
        toast.error("Couldn't delete this post.");
        return;
      }
      toast.success("Post deleted. The image is in your library.");
    });
  }

  const pending = unschedulePending || deletePending;
  const dateLabel = formatScheduledTime(row.scheduledTime);

  return (
    <article className="bg-card rounded-2xl border border-border p-6 shadow-soft flex flex-col sm:flex-row gap-6">
      <div className="shrink-0">
        {row.imageUrl ? (
          <Image
            src={row.imageUrl}
            alt=""
            width={160}
            height={160}
            className="rounded-lg object-cover size-32 sm:size-40"
            unoptimized
          />
        ) : (
          <div className="rounded-lg bg-muted size-32 sm:size-40 flex items-center justify-center text-xs text-muted-foreground">
            No image
          </div>
        )}
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
            variant="outline"
            size="sm"
            onClick={handleUnschedule}
            disabled={pending}
          >
            {unschedulePending ? "Unscheduling…" : "Unschedule"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
          >
            {deletePending ? "Deleting…" : "Delete"}
          </Button>
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
