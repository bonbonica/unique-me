import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UnscheduledBatchCard as Data } from "@/lib/services/post-service";
import { cn } from "@/lib/utils";

type Props = { data: Data };

/**
 * Presentational card for a single unscheduled batch on the Create Posts hub.
 *
 * Server component — no client state, no event handlers. The only interactive
 * affordance is the `[Open →]` Link rendered inside a `<Button asChild>`.
 * The card body itself is intentionally not clickable so users can read the
 * theme without triggering navigation (see task-05 §"Out of scope").
 */
export function UnscheduledBatchCard({ data }: Props) {
  const chip = STATE_CHIP[data.status];

  return (
    <article
      className={cn(
        "bg-card text-card-foreground rounded-2xl border border-border p-6",
        "shadow-soft transition-all duration-300 ease-out",
        "hover:shadow-lift hover:-translate-y-0.5",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="font-fraunces text-xl tracking-tight font-medium">
            BATCH
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Badge variant={chip.variant} className={chip.className}>
            {chip.label}
          </Badge>
        </div>
      </div>

      <p className="mt-3 text-base text-foreground leading-7">{data.theme}</p>
      <p className="mt-1 text-sm text-muted-foreground line-clamp-1">
        {data.importantThing}
      </p>

      <div className="mt-5 flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-muted-foreground">
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
            posts
          </span>
        </div>

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
      {label}{" "}
      <span className="text-foreground font-medium">{count}</span>
    </span>
  );
}

/**
 * State chip lookup. Keyed by the narrowed `UnscheduledBatchCard.status`
 * union so adding a new status to the service type forces a compile error
 * here until the chip is defined.
 *
 * - `reviewing` uses the default Badge variant (champagne tint per
 *   DESIGN.md §9) — no className override needed.
 * - `cancelled` uses an amber-tinted outline variant (warning family per
 *   DESIGN.md §3), not destructive coral, because re-scheduling is a
 *   recoverable next step rather than an error.
 */
const STATE_CHIP: Record<
  Data["status"],
  {
    label: string;
    variant: "default" | "outline";
    className: string;
  }
> = {
  reviewing: {
    label: "IN REVIEW",
    variant: "default",
    className: "",
  },
  cancelled: {
    label: "CANCELLED — re-schedule",
    variant: "outline",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
};
