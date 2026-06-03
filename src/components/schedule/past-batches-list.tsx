import { ChevronRight } from "lucide-react";
import type { PastBatchRow } from "@/lib/services/post-service";
import { cn } from "@/lib/utils";

type Props = { rows: PastBatchRow[] };

/**
 * Closed-by-default disclosure listing finished (`completed`) batches in the
 * current 30-day period. The empty state lives inside the disclosure body so
 * users see `"No finished batches in this period."` only after expanding —
 * the summary line still surfaces the count.
 *
 * Stage-1 production: this list is always empty (no posting-service yet to
 * mark batches `completed`). Phase 7 populates it without further changes.
 */
export function PastBatchesList({ rows }: Props) {
  return (
    <details className="group">
      <summary
        className={cn(
          "flex items-center gap-2 cursor-pointer list-none",
          "text-sm font-medium text-foreground py-3 select-none",
        )}
      >
        <ChevronRight
          className="size-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
          strokeWidth={1.5}
        />
        <span>Past batches</span>
        <span className="text-muted-foreground">({rows.length})</span>
      </summary>

      <div className="pt-2 pb-1 pl-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">
            No finished batches in this period.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <PastBatchRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function PastBatchRowItem({ row }: { row: PastBatchRow }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 text-sm">
      <span className="text-muted-foreground w-20 shrink-0">
        {formatDate(row.completedAt)}
      </span>
      <span className="flex-1 text-foreground truncate">{row.theme}</span>
      <span className="text-muted-foreground shrink-0">
        {row.totalPosts} posts <span aria-hidden="true">✓</span>
      </span>
    </li>
  );
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
}
