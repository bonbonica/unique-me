"use client";

import { useSyncExternalStore } from "react";

/**
 * `<DayLabel />` — renders "Day N · Weekday" for a single post within a
 * batch. Day 1 corresponds to the weekday `batchCreatedAt` falls on **in
 * the user's browser timezone** (Phase 3 spec D8 — browser is the
 * authoritative timezone source, no DB column, no server-side compute).
 *
 * Hydration discipline mirrors `<QuotaGatedScreen />` /
 * `<NextBatchBanner />` / `<QuotaCountdownPill />`: the server pass and
 * the first client pass both emit just `Day {N}` (no weekday) so the
 * markup matches. After mount, the real `Day {N} · {Weekday}` string
 * appears. The one-frame flash is explicitly accepted in spec § 9.
 *
 * Order is "Day N · Weekday" — locked. Users scan-read the day number
 * first ("how far through the week am I?"), the weekday is the qualifier.
 */
export function DayLabel({
  postOrder,
  batchCreatedAt,
}: {
  postOrder: number;
  batchCreatedAt: Date | string;
}) {
  const mounted = useHasMounted();
  const label = mounted
    ? buildDayLabel(postOrder, batchCreatedAt)
    : `Day ${postOrder}`;

  return (
    <span className="text-xs text-muted-foreground font-medium">{label}</span>
  );
}

/**
 * `useSyncExternalStore`-based mount sentinel. Returns `false` during SSR
 * and the first client render, then `true` afterwards. Same idiom as
 * `<QuotaGatedScreen />` — keeps us off the
 * `react-hooks/set-state-in-effect` lint rule while still producing
 * identical server and first-client markup so hydration matches.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Module-scope helper so the impure `Intl.DateTimeFormat` read lives
 * outside the component body — the React purity lint rule only fires on
 * component/hook bodies, and gating this call behind `mounted` already
 * guarantees it runs only on the client after hydration.
 *
 * DST drift across 6 days is at most 1 hour, which never changes the
 * weekday, so the plain `+ (postOrder - 1) * 86_400_000` math is safe and
 * keeps us off any date-library dependency.
 */
function buildDayLabel(
  postOrder: number,
  batchCreatedAt: Date | string,
): string {
  const base =
    batchCreatedAt instanceof Date
      ? batchCreatedAt
      : new Date(batchCreatedAt);
  const dayDate = new Date(base.getTime() + (postOrder - 1) * 86_400_000);
  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(dayDate);
  return `Day ${postOrder} · ${weekday}`;
}
