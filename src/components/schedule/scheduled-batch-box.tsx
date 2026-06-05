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
 * Color-coded box for a single current-period batch on the Scheduled page.
 *
 * Two `derivedState` variants exist in the tone map:
 *  - `upcoming` (champagne) — the only one Stage-1 data ever produces.
 *  - `currently_posting` (emerald) — dormant Stage-1 contract; activates when
 *    Phase 4's `scheduleService` + Phase 7's `postingService` ship and start
 *    flipping `BatchBoxData.derivedState`. The variant must look correct
 *    against DESIGN.md tokens so Phase 4 doesn't have to touch this file.
 *
 * No "finished/grey" variant — completed batches render via
 * `<PastBatchesList />` as compact rows, not full boxes.
 */
export function ScheduledBatchBox({ data, onCancelClick }: Props) {
  const tone = STATE_TONE[data.derivedState];
  const label = formatLabel(data.ordinal, tone.copyLabel);

  return (
    <article
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border",
        "shadow-soft overflow-hidden",
      )}
      aria-label={
        data.ordinal !== null
          ? `Batch ${data.ordinal}, ${tone.copyLabel.toLowerCase()}`
          : `Batch, ${tone.copyLabel.toLowerCase()}`
      }
    >
      <header
        className={cn(
          "px-6 py-3 border-b text-xs font-medium tracking-wider uppercase",
          tone.headerStrip,
        )}
      >
        {label}
      </header>

      <div className="p-6 space-y-5">
        <div>
          <p className="text-base text-foreground leading-7">{data.theme}</p>
          <p className="mt-1 text-sm text-muted-foreground">
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
          <Link
            href={`/schedule/${data.id}`}
            className="text-foreground font-medium hover:underline underline-offset-4 decoration-primary/60"
          >
            {data.totalPosts} posts
          </Link>
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
    ? `BATCH ${ordinal} · ${stateLabel}`
    : `BATCH · ${stateLabel}`;
}

const STATE_TONE: Record<
  BatchBoxData["derivedState"],
  { copyLabel: string; headerStrip: string }
> = {
  upcoming: {
    copyLabel: "UPCOMING",
    headerStrip: "bg-primary/15 text-primary border-b-primary/30",
  },
  currently_posting: {
    copyLabel: "CURRENTLY POSTING",
    headerStrip:
      "bg-emerald-500/15 text-emerald-300 border-b-emerald-500/30",
  },
};
