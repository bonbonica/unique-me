"use client";

import { useSyncExternalStore } from "react";
import { ordinalToDate } from "@/lib/scheduling/ordinal-to-date";
import type { PostingDays } from "@/lib/schema";

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
 *
 * Onboarding-posting-preferences (Wave 2): `dayWindow` and `postingDays`
 * are required so the weekday lookup uses the same filtered-offsets list
 * `<NetworkDayGrid />` and `resolveBatchPlan` use — under
 * `working_days_only` or `weekends_only` the slot ordinal no longer maps
 * linearly to calendar days. Callsites collapse legacy NULLs via
 * `dayWindowOrFallback` / `postingDaysOrFallback` so the prop is
 * always non-null.
 */
export function DayLabel({
  postOrder,
  batchCreatedAt,
  dayWindow,
  postingDays,
}: {
  postOrder: number;
  batchCreatedAt: Date | string;
  dayWindow: number;
  postingDays: PostingDays;
}) {
  const mounted = useHasMounted();
  const label = mounted
    ? buildDayLabel(postOrder, batchCreatedAt, dayWindow, postingDays)
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
 * DST drift across up to 9 days is at most 1 hour, which never changes
 * the weekday, so the underlying `+ offset * 86_400_000` math inside
 * `ordinalToDate` is safe and keeps us off any date-library dependency.
 */
function buildDayLabel(
  postOrder: number,
  batchCreatedAt: Date | string,
  dayWindow: number,
  postingDays: PostingDays,
): string {
  const base =
    batchCreatedAt instanceof Date
      ? batchCreatedAt
      : new Date(batchCreatedAt);
  // `dayWindow` is widened to `number` on the prop boundary so callsites
  // don't have to thread a literal-typed `7 | 9` through five layers of
  // prop drilling. `dayWindowOrFallback` only ever returns `7` or `9`,
  // so the runtime narrowing here is a no-op for normal callsites; the
  // ternary collapses any other value to `7` defensively.
  const narrowedWindow: 7 | 9 = dayWindow === 9 ? 9 : 7;
  const dayDate = ordinalToDate(base, postOrder, narrowedWindow, postingDays);
  const weekday = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
  }).format(dayDate);
  return `Day ${postOrder} · ${weekday}`;
}
