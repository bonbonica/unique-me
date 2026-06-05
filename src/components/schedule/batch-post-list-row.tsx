"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CancelPostDialog } from "./cancel-post-dialog";
import { RestorePostDialog } from "./restore-post-dialog";
import type { SectionRow } from "./batch-detail-view";

/**
 * One row per `(postId, platform)` `scheduled_posts` entry inside a per-network
 * section. Client component because it owns the dialog open state.
 *
 * Renders:
 *  - Day label + per-network scheduled time (the row's own `scheduledTime` —
 *    THIS is where the per-network 9:00 / 9:05 / 9:10 offset surfaces).
 *  - Post text (line-clamped — full text lives on the post editor; this page
 *    is read-only per the spec out-of-scope list).
 *  - `[Cancel]` button when the row is live AND the D-S2-7 gate is open
 *    (pre-computed server-side as `row.canCancel`).
 *  - `[Restore]` button when the row is cancelled AND the D-S2-21 gate is
 *    open (pre-computed as `row.canRestore`).
 *
 * Cancelled rows render greyed (`bg-muted/30 italic`) so the user can see the
 * post is right where they expect it — the per-network section is the truth
 * about what was set to publish to this network, including what was cancelled.
 * (Decision per task-15: keep cancelled rows in-section rather than splitting
 * into a separate "Cancelled" section — the grid X cell is the at-a-glance
 * signal; the row is the action surface.)
 */
export function BatchPostListRow({
  row,
  batchId,
}: {
  row: SectionRow;
  batchId: string;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const isCancelled = row.status === "cancelled";

  // Locale-aware formatting. The fallback labels avoid an empty string when
  // `toLocaleString` falls back on a stub (e.g. test environments).
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    row.scheduledTime.getDay()
  ];
  const date = row.scheduledTime.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = row.scheduledTime.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const containerCls = isCancelled
    ? "rounded-2xl border border-border bg-muted/30 p-6 italic space-y-3"
    : "rounded-2xl border border-border bg-card p-6 shadow-soft space-y-3";

  return (
    <div className={containerCls}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          Day {row.postOrder} — {dow} {date} · {time}
          {isCancelled && (
            <span className="ml-2 normal-case font-normal">(Cancelled)</span>
          )}
        </p>
        {!isCancelled && row.canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCancelOpen(true)}
          >
            Cancel
          </Button>
        )}
        {isCancelled && row.canRestore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRestoreOpen(true)}
          >
            Restore
          </Button>
        )}
      </div>
      <p
        className={
          isCancelled
            ? "text-base leading-7 text-muted-foreground line-clamp-3"
            : "text-base leading-7 text-foreground line-clamp-3"
        }
      >
        {row.postText}
      </p>

      {!isCancelled && row.canCancel && (
        <CancelPostDialog
          postId={row.postId}
          batchId={batchId}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
      )}
      {isCancelled && row.canRestore && (
        <RestorePostDialog
          postId={row.postId}
          batchId={batchId}
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
        />
      )}
    </div>
  );
}
