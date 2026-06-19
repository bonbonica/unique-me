"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { BatchBoxData } from "@/lib/services/post-service";
import { cn } from "@/lib/utils";

type Props = {
  data: BatchBoxData;
  onCancelClick: () => void;
};

/**
 * Champagne-tinted box for a single current-period batch on the Posting
 * Soon page. The previous `derivedState` switch (with a dormant
 * `currently_posting` variant) was removed by the navigation redesign — the
 * "Currently Posting" concept is gone from the IA, so every box renders
 * with the upcoming tone.
 *
 * No "finished/grey" variant — completed batches render via
 * `<PastBatchesList />` as compact rows, not full boxes.
 */
export function ScheduledBatchBox({ data, onCancelClick }: Props) {
  const label = formatLabel(data.ordinal, BOX_COPY_LABEL);
  // Total content pieces across networks. Unique copy per network means one
  // day-slot can yield up to 3 posts (FB + IG + LI), so a 7-day batch can
  // produce more than 7 posts. `data.totalPosts` is the nominal day count
  // (`weeklyBatches.totalPosts`); `postsTotal` is the per-network sum from
  // `post_selections` via `loadSelectionCounts`. Both numbers are shown so the
  // user sees their day cadence AND their actual content count — see spec
  // §6.7 / D-S2-14.
  const postsTotal =
    data.counts.facebook + data.counts.instagram + data.counts.linkedin;

  return (
    <article
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border",
        "shadow-soft overflow-hidden",
      )}
      aria-label={
        data.ordinal !== null
          ? `Batch ${data.ordinal}, ${BOX_COPY_LABEL.toLowerCase()}`
          : `Batch, ${BOX_COPY_LABEL.toLowerCase()}`
      }
    >
      <header
        className={cn(
          "px-6 py-3 border-b text-xs font-medium tracking-wider uppercase",
          BOX_HEADER_STRIP,
        )}
      >
        {label}
      </header>

      <div className="p-6 space-y-5">
        <div>
          <p className="text-base text-foreground leading-7 select-text cursor-text">
            {data.theme}
          </p>
          <p className="mt-1 text-sm text-muted-foreground select-text cursor-text">
            {data.importantThing}
          </p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3 text-muted-foreground">
            <NetworkCount label="FB" count={data.counts.facebook} />
            <span aria-hidden="true">·</span>
            <NetworkCount label="IG" count={data.counts.instagram} />
            <span aria-hidden="true">·</span>
            <NetworkCount label="LI" count={data.counts.linkedin} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">
              {data.totalPosts} days
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <Link
              href={`/posting-soon/${data.id}`}
              className="text-foreground font-medium hover:underline underline-offset-4 decoration-primary/60"
            >
              {postsTotal} posts
            </Link>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onCancelClick}>
            Cancel batch
          </Button>
        </div>
      </div>
    </article>
  );
}

function NetworkCount({ label, count }: { label: string; count: number }) {
  return (
    <span>
      {label} <span className="text-foreground font-medium">{count}</span>
    </span>
  );
}

function formatLabel(ordinal: number | null, stateLabel: string): string {
  return ordinal !== null
    ? `BATCH ${ordinal}/4 · ${stateLabel}`
    : `BATCH · ${stateLabel}`;
}

const BOX_COPY_LABEL = "UPCOMING";
const BOX_HEADER_STRIP = "bg-primary/15 text-primary border-b-primary/30";
