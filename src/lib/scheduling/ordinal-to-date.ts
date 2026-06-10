/**
 * Pure render helper for batch calendar dates. Given a batch's `createdAt`
 * and a 1-indexed `ordinal` within the batch, returns the `Date` that slot
 * lands on after applying the user's posting-days filter.
 *
 * Read sites used to do `createdAt + (order - 1) * 86_400_000` inline,
 * which assumed every calendar day received a post. With
 * `working_days_only` / `weekends_only` filtering, the mapping from slot
 * ordinal to calendar day is non-linear, so it routes through the same
 * `resolveBatchPlan` the writer uses to build the slot list in the first
 * place.
 */

import { resolveBatchPlan } from "@/lib/scheduling/batch-calendar";
import type { PostingDays } from "@/lib/schema";

const DAY_MS = 86_400_000;

export function ordinalToDate(
  batchCreatedAt: Date,
  ordinal: number,
  dayWindow: 7 | 9,
  postingDays: PostingDays,
): Date {
  const { dayOffsets } = resolveBatchPlan(batchCreatedAt, dayWindow, postingDays);
  const index = ordinal - 1;
  const baseTime = batchCreatedAt.getTime();

  // Defensive: writer derives totalPosts from dayOffsets.length, so a caller
  // asking for an ordinal beyond the plan would mean an upstream bug. Fall
  // back to the legacy linear mapping rather than throwing — schedule grids
  // would rather render a slightly wrong date than crash.
  if (index < 0 || index >= dayOffsets.length) {
    return new Date(baseTime + (ordinal - 1) * DAY_MS);
  }

  return new Date(baseTime + (dayOffsets[index] as number) * DAY_MS);
}
