import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UnscheduledBatchCard as Data } from "@/lib/services/post-service";
import { cn } from "@/lib/utils";
import { DeleteBatchForeverTrigger } from "./delete-batch-forever-trigger";
import type { DeleteWarning } from "./delete-batch-forever-dialog";

type Props = { data: Data; warning: DeleteWarning };

/**
 * Presentational card for a single unscheduled batch on the Create Posts hub.
 *
 * Anatomy mirrors `<ScheduledBatchBox />` (§6.7): a tinted header strip
 * carrying `BATCH {ordinal}/4 · {STATUS}` followed by a `p-6` body with the
 * theme, important-thing, counts row, and action(s). The strip + body pattern
 * is now consistent across `/create` and `/schedule`, so the only visual
 * differences between a reviewing/cancelled card and an upcoming box come
 * from the strip tint (champagne / amber / champagne) and the bottom-right
 * action affordance.
 *
 * Two status variants:
 *  - `reviewing` — champagne strip; `[Open →]` CTA at bottom-right.
 *  - `cancelled` — amber strip (warm warning family per DESIGN.md §3); the
 *    primary action `[Posts are cancelled, click to reschedule →]` sits at
 *    the top of the body (preserved from D-S2-16); destructive
 *    `[Delete forever]` sits at the bottom-right. The strip and the long
 *    button both surface the cancelled state — kept deliberately: the strip
 *    is the at-a-glance status chrome, the button is the action verb.
 *
 * Right-side count line matches `<ScheduledBatchBox />` per D-S2-14:
 * `FB N · IG N · LI N · {days} days · {posts} posts`. Both pages read the
 * same `post_selections` aggregate via `loadSelectionCounts`, so the totals
 * cannot diverge.
 *
 * Server component — no client state. The only client boundary is the
 * `<DeleteBatchForeverTrigger />` on cancelled cards (it owns the confirm
 * dialog open state). Theme + important-thing carry `select-text cursor-text`
 * so users can copy their own content; the rest of the card surface is
 * non-selectable per the body-wide reset in `globals.css` (D-S2-23).
 */
export function UnscheduledBatchCard({ data, warning }: Props) {
  // Total content pieces across networks — see file docblock for the
  // rationale. Same formula used by `<ScheduledBatchBox />` so /create and
  // /schedule labels stay aligned for the same batch.
  const postsTotal =
    data.counts.facebook + data.counts.instagram + data.counts.linkedin;
  const isCancelled = data.status === "cancelled";
  const strip = STATE_STRIP[data.status];

  return (
    <article
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border",
        "shadow-soft overflow-hidden",
        "transition-all duration-300 ease-out",
        "hover:shadow-lift hover:-translate-y-0.5",
      )}
      aria-label={
        data.ordinal !== null
          ? `Batch ${data.ordinal} of 4, ${strip.copyLabel.toLowerCase()}`
          : `Batch, ${strip.copyLabel.toLowerCase()}`
      }
    >
      <header
        className={cn(
          "px-6 py-3 border-b text-xs font-medium tracking-wider uppercase",
          strip.headerStrip,
        )}
      >
        {formatStripLabel(data.ordinal, strip.copyLabel)}
      </header>

      <div className="p-6 space-y-5">
        {isCancelled && (
          <div className="flex justify-end">
            <Button asChild size="sm">
              <Link href={`/posts?batchId=${data.id}`}>
                Posts are cancelled, click to reschedule
                <ArrowRight
                  className="ml-1 size-4"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </Link>
            </Button>
          </div>
        )}

        <div>
          <p className="text-base text-foreground leading-7 select-text cursor-text">
            {data.theme}
          </p>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-1 select-text cursor-text">
            {data.importantThing}
          </p>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3 text-muted-foreground flex-wrap">
            <NetworkCount label="FB" count={data.counts.facebook} />
            <span aria-hidden="true">·</span>
            <NetworkCount label="IG" count={data.counts.instagram} />
            <span aria-hidden="true">·</span>
            <NetworkCount label="LI" count={data.counts.linkedin} />
            <span aria-hidden="true">·</span>
            <span>
              <span className="text-foreground font-medium">
                {data.totalPosts}
              </span>{" "}
              days
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <span className="text-foreground font-medium">{postsTotal}</span>{" "}
              posts
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isCancelled ? (
              <DeleteBatchForeverTrigger
                batchId={data.id}
                imageCount={data.totalPosts}
                warning={warning}
              />
            ) : (
              <Button asChild size="sm">
                <Link href={`/posts?batchId=${data.id}`}>
                  Open
                  <ArrowRight
                    className="ml-1 size-4"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Inline network-count atom — keeps the FB/IG/LI rendering tidy in the
 * counts row. Counts render in foreground/medium for emphasis; the label
 * inherits the row's muted-foreground colour.
 */
function NetworkCount({ label, count }: { label: string; count: number }) {
  return (
    <span>
      {label} <span className="text-foreground font-medium">{count}</span>
    </span>
  );
}

/**
 * Strip label formatter — mirrors `<ScheduledBatchBox />`'s pattern so /create
 * and /schedule strips read identically: `BATCH N/4 · STATUS` for Pro,
 * `BATCH · STATUS` for Trial / Starter (no ordinal). The `/4` is the Pro
 * monthly cap (D-A1 / D-S2-10) — surfaced on every batch so the user can see
 * which slot was burned even after cancelling.
 */
function formatStripLabel(ordinal: number | null, stateLabel: string): string {
  return ordinal !== null
    ? `BATCH ${ordinal}/4 · ${stateLabel}`
    : `BATCH · ${stateLabel}`;
}

/**
 * Strip styling + label per status. Keyed by the narrowed
 * `UnscheduledBatchCard.status` union so adding a new status surfaces a
 * compile error here until the strip is defined.
 *
 *  - `reviewing` — champagne tint, matches `<ScheduledBatchBox />`'s
 *    `upcoming` strip so a batch that flips reviewing → scheduling keeps the
 *    same visual identity across pages.
 *  - `cancelled` — amber tinted BACKGROUND (warm warning family per
 *    DESIGN.md §3, not destructive coral — re-scheduling is recoverable,
 *    not an error) with `text-primary` LETTERS so the `BATCH N/4 · CANCELLED`
 *    label uses the same antique-brass/champagne tone the `<CurrentlyPostingCta />`
 *    button uses as its background. Both /create card variants therefore render
 *    the strip label in `--primary` and stay visually consistent with the
 *    other primary surfaces on the page.
 */
const STATE_STRIP: Record<
  Data["status"],
  { copyLabel: string; headerStrip: string }
> = {
  reviewing: {
    copyLabel: "IN REVIEW",
    headerStrip: "bg-primary/15 text-primary border-b-primary/30",
  },
  cancelled: {
    copyLabel: "CANCELLED",
    headerStrip:
      "bg-amber-500/15 text-primary border-b-amber-500/30",
  },
};
