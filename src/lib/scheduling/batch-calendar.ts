/**
 * Pure scheduling helpers for the onboarding-posting-preferences feature.
 *
 * Two responsibilities:
 *  - `resolveBatchPlan` — given a batch's `createdAt`, its calendar span
 *    (`dayWindow` of 7 or 9), and the user's posting-days preference,
 *    return the filtered list of day offsets (0-indexed from createdAt)
 *    that actually receive a post. `totalPosts` is the resulting length.
 *  - `resolveLengthsForBatch` — given a chosen `PostLength` (which may be
 *    `"mix"`) and a `batchId`, return a per-slot length array of length
 *    `totalPosts`. The output never contains `"mix"` — only the three
 *    concrete lengths. For `"mix"`, the balanced split is shuffled with a
 *    seeded RNG (mulberry32 keyed by FNV-1a of `batchId`) so a single-post
 *    regenerate can re-derive the same sequence without DB lookup.
 *
 * Legacy-row fallback semantics: `weekly_batches.day_window` and
 * `weekly_batches.posting_days` are nullable for back-compat with batches
 * created before Wave 1. The two `*OrFallback` helpers collapse NULL into
 * the every-day-equivalent values that match pre-feature behaviour. Read
 * sites must call the helpers; they never pass NULL into the resolvers.
 *
 * No I/O, no DB, no React. Safe to import from anywhere.
 */

import type { PostingDays, PostLength } from "@/lib/schema";

export type CalendarPlan = {
  totalPosts: number;
  dayOffsets: number[];
};

const DAY_MS = 86_400_000;

const WORKING_DAY_SET: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
const WEEKEND_DAY_SET: ReadonlySet<number> = new Set([0, 6]);

export function resolveBatchPlan(
  batchCreatedAt: Date,
  dayWindow: 7 | 9,
  postingDays: PostingDays,
): CalendarPlan {
  const baseTime = batchCreatedAt.getTime();
  const dayOffsets: number[] = [];

  for (let offset = 0; offset < dayWindow; offset++) {
    if (postingDays === "every_day") {
      dayOffsets.push(offset);
      continue;
    }
    const dow = new Date(baseTime + offset * DAY_MS).getDay();
    if (postingDays === "working_days_only" && WORKING_DAY_SET.has(dow)) {
      dayOffsets.push(offset);
    } else if (postingDays === "weekends_only" && WEEKEND_DAY_SET.has(dow)) {
      dayOffsets.push(offset);
    }
  }

  return { totalPosts: dayOffsets.length, dayOffsets };
}

export function resolveLengthsForBatch(
  totalPosts: number,
  postLength: PostLength,
  batchId: string,
): PostLength[] {
  if (totalPosts <= 0) return [];

  if (postLength !== "mix") {
    return Array<PostLength>(totalPosts).fill(postLength);
  }

  // Balanced split per spec §4 table (N=2 → 0/1/1, N=7 → 2/3/2, etc.).
  const short = Math.floor(totalPosts / 3);
  const long = Math.floor(totalPosts / 3) + (totalPosts % 3 >= 2 ? 1 : 0);
  const medium = totalPosts - short - long;

  const multiset: PostLength[] = [
    ...Array<PostLength>(short).fill("short"),
    ...Array<PostLength>(medium).fill("medium"),
    ...Array<PostLength>(long).fill("long"),
  ];

  return seededShuffle(multiset, batchId);
}

export function dayWindowOrFallback(batch: {
  dayWindow: number | null;
  totalPosts: number;
}): 7 | 9 {
  if (batch.dayWindow === 7 || batch.dayWindow === 9) {
    return batch.dayWindow;
  }
  return batch.totalPosts === 9 ? 9 : 7;
}

export function postingDaysOrFallback(batch: {
  postingDays: string | null;
}): PostingDays {
  if (
    batch.postingDays === "every_day" ||
    batch.postingDays === "working_days_only" ||
    batch.postingDays === "weekends_only"
  ) {
    return batch.postingDays;
  }
  return "every_day";
}

/**
 * Best-effort post-count estimate for a (dayWindow, postingDays) pair, used by
 * the Settings preview line. Returns `{ min, max }` because the day-of-week
 * filter makes `working_days_only` / `weekends_only` start-day-dependent on a
 * 9-day window — see spec §1 table.
 *
 * Walks all 7 possible starting weekdays via `resolveBatchPlan` so the answer
 * stays consistent with whatever the live filter produces. The reference epoch
 * is arbitrary — only its day-of-week varies as `i` sweeps 0..6.
 */
export function estimatePostsPerBatch(
  dayWindow: 7 | 9,
  postingDays: PostingDays,
): { min: number; max: number } {
  // 2024-01-01 is a Monday (dow=1); offsetting by 0..6 covers every starting DOW.
  const reference = new Date(2024, 0, 1).getTime();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 7; i++) {
    const start = new Date(reference + i * DAY_MS);
    const { totalPosts } = resolveBatchPlan(start, dayWindow, postingDays);
    if (totalPosts < min) min = totalPosts;
    if (totalPosts > max) max = totalPosts;
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Seeded PRNG primitives — kept tiny + inline so the module has zero deps
// and the shuffle stays deterministic per `batchId`.
// ---------------------------------------------------------------------------

export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication, kept inside Uint32 range.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rand = mulberry32(fnv1a(seed));
  // Fisher-Yates from the back; `i > 0` keeps the final swap meaningful.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
