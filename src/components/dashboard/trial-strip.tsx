import { Sparkles } from "lucide-react";

/**
 * Trial countdown pill shown in {@link DashboardTopBar} when the user is on
 * the 7-day Pro trial. Communicates two things at once: (1) you're trying
 * Pro features, and (2) how long is left.
 *
 * Visibility:
 *  - Renders only when the caller passes a non-null days-left count.
 *  - Self-hidden below `sm` (the parent TopBar is already hidden below `md`,
 *    so this is effectively a no-op on mobile — the `sm:flex` class is for
 *    safety if the TopBar's breakpoint ever loosens).
 */
export function TrialStrip({ daysLeft }: { daysLeft: number }) {
  return (
    <div className="hidden sm:flex items-center gap-2 rounded-full bg-primary/15 border border-primary/30 px-3 py-1 text-xs">
      <Sparkles className="size-3 text-primary" aria-hidden />
      <span className="text-primary font-medium">
        Pro trial — {daysLeft} {daysLeft === 1 ? "day" : "days"} left
      </span>
    </div>
  );
}
