import { describe, expect, it } from "vitest";
import {
  dayWindowOrFallback,
  postingDaysOrFallback,
  resolveBatchPlan,
  resolveLengthsForBatch,
} from "@/lib/scheduling/batch-calendar";
import type { PostLength, PostingDays } from "@/lib/schema";

// Local-time constructors so the day-of-week math doesn't depend on the
// runner's timezone. Jan 1 2024 is a Monday; Jan 3 a Wednesday; Jan 6 a
// Saturday — all verified.
const MONDAY = new Date(2024, 0, 1);
const WEDNESDAY = new Date(2024, 0, 3);
const SATURDAY = new Date(2024, 0, 6);

describe("resolveBatchPlan", () => {
  describe("every_day", () => {
    it.each<[Date, 7 | 9]>([
      [MONDAY, 7],
      [WEDNESDAY, 7],
      [SATURDAY, 7],
      [MONDAY, 9],
      [WEDNESDAY, 9],
      [SATURDAY, 9],
    ])("keeps every offset for start=%s window=%i", (start, window) => {
      const plan = resolveBatchPlan(start, window, "every_day");
      const expected = Array.from({ length: window }, (_, i) => i);
      expect(plan.totalPosts).toBe(window);
      expect(plan.dayOffsets).toEqual(expected);
    });
  });

  describe("working_days_only", () => {
    it("Monday start, 7-day → Mon..Fri", () => {
      const plan = resolveBatchPlan(MONDAY, 7, "working_days_only");
      expect(plan.totalPosts).toBe(5);
      expect(plan.dayOffsets).toEqual([0, 1, 2, 3, 4]);
    });

    it("Wednesday start, 7-day → Wed..Fri + next Mon/Tue", () => {
      const plan = resolveBatchPlan(WEDNESDAY, 7, "working_days_only");
      expect(plan.totalPosts).toBe(5);
      expect(plan.dayOffsets).toEqual([0, 1, 2, 5, 6]);
    });

    it("Saturday start, 7-day → next Mon..Fri only", () => {
      const plan = resolveBatchPlan(SATURDAY, 7, "working_days_only");
      expect(plan.totalPosts).toBe(5);
      expect(plan.dayOffsets).toEqual([2, 3, 4, 5, 6]);
    });

    it("Monday start, 9-day → 7 posts (Mon..Fri + next Mon/Tue)", () => {
      const plan = resolveBatchPlan(MONDAY, 9, "working_days_only");
      expect(plan.totalPosts).toBe(7);
      expect(plan.dayOffsets).toEqual([0, 1, 2, 3, 4, 7, 8]);
    });

    it("Wednesday start, 9-day → 7 posts", () => {
      const plan = resolveBatchPlan(WEDNESDAY, 9, "working_days_only");
      expect(plan.totalPosts).toBe(7);
      expect(plan.dayOffsets).toEqual([0, 1, 2, 5, 6, 7, 8]);
    });

    it("Saturday start, 9-day → 5 posts (only the Mon..Fri block)", () => {
      const plan = resolveBatchPlan(SATURDAY, 9, "working_days_only");
      expect(plan.totalPosts).toBe(5);
      expect(plan.dayOffsets).toEqual([2, 3, 4, 5, 6]);
    });
  });

  describe("weekends_only", () => {
    it("Monday start, 7-day → next Sat/Sun", () => {
      const plan = resolveBatchPlan(MONDAY, 7, "weekends_only");
      expect(plan.totalPosts).toBe(2);
      expect(plan.dayOffsets).toEqual([5, 6]);
    });

    it("Wednesday start, 7-day → Sat/Sun within window", () => {
      const plan = resolveBatchPlan(WEDNESDAY, 7, "weekends_only");
      expect(plan.totalPosts).toBe(2);
      expect(plan.dayOffsets).toEqual([3, 4]);
    });

    it("Saturday start, 7-day → today + Sun", () => {
      const plan = resolveBatchPlan(SATURDAY, 7, "weekends_only");
      expect(plan.totalPosts).toBe(2);
      expect(plan.dayOffsets).toEqual([0, 1]);
    });

    it("Monday start, 9-day → single Sat/Sun pair", () => {
      const plan = resolveBatchPlan(MONDAY, 9, "weekends_only");
      expect(plan.totalPosts).toBe(2);
      expect(plan.dayOffsets).toEqual([5, 6]);
    });

    it("Wednesday start, 9-day → single Sat/Sun pair", () => {
      const plan = resolveBatchPlan(WEDNESDAY, 9, "weekends_only");
      expect(plan.totalPosts).toBe(2);
      expect(plan.dayOffsets).toEqual([3, 4]);
    });

    it("Saturday start, 9-day → both Sat/Sun pairs", () => {
      const plan = resolveBatchPlan(SATURDAY, 9, "weekends_only");
      expect(plan.totalPosts).toBe(4);
      expect(plan.dayOffsets).toEqual([0, 1, 7, 8]);
    });
  });
});

describe("resolveLengthsForBatch", () => {
  describe("uniform (non-mix)", () => {
    const uniformLengths: ReadonlyArray<Exclude<PostLength, "mix">> = [
      "short",
      "medium",
      "long",
    ];
    const counts = [2, 5, 7, 9] as const;

    for (const length of uniformLengths) {
      for (const n of counts) {
        it(`returns ${n} × ${length}`, () => {
          const result = resolveLengthsForBatch(n, length, "any-seed");
          expect(result).toHaveLength(n);
          expect(result.every((entry) => entry === length)).toBe(true);
        });
      }
    }
  });

  describe("mix — balanced split per spec §4 table", () => {
    const cases: ReadonlyArray<{ n: number; s: number; m: number; l: number }> = [
      { n: 2, s: 0, m: 1, l: 1 },
      { n: 3, s: 1, m: 1, l: 1 },
      { n: 4, s: 1, m: 2, l: 1 },
      { n: 5, s: 1, m: 2, l: 2 },
      { n: 6, s: 2, m: 2, l: 2 },
      { n: 7, s: 2, m: 3, l: 2 },
      { n: 9, s: 3, m: 3, l: 3 },
    ];

    for (const { n, s, m, l } of cases) {
      it(`N=${n} → ${s}/${m}/${l} short/medium/long`, () => {
        const result = resolveLengthsForBatch(n, "mix", `batch-${n}`);
        expect(result).toHaveLength(n);
        expect(result.includes("mix" as PostLength)).toBe(false);
        const sorted = result.slice().sort();
        const expected = [
          ...Array<PostLength>(l).fill("long"),
          ...Array<PostLength>(m).fill("medium"),
          ...Array<PostLength>(s).fill("short"),
        ].sort();
        expect(sorted).toEqual(expected);
      });
    }
  });

  it("mix output is deterministic per batchId", () => {
    const a = resolveLengthsForBatch(7, "mix", "seed-a");
    const b = resolveLengthsForBatch(7, "mix", "seed-a");
    expect(a).toEqual(b);
  });

  it("mix output varies across different batchIds", () => {
    const a = resolveLengthsForBatch(7, "mix", "seed-a").join(",");
    const b = resolveLengthsForBatch(7, "mix", "seed-b").join(",");
    expect(a).not.toBe(b);
  });
});

describe("dayWindowOrFallback", () => {
  it("returns 7 when dayWindow is NULL and totalPosts !== 9", () => {
    expect(
      dayWindowOrFallback({ dayWindow: null, totalPosts: 7 }),
    ).toBe(7);
  });

  it("returns 9 when dayWindow is NULL and totalPosts === 9", () => {
    expect(
      dayWindowOrFallback({ dayWindow: null, totalPosts: 9 }),
    ).toBe(9);
  });

  it("passes through 7", () => {
    expect(
      dayWindowOrFallback({ dayWindow: 7, totalPosts: 5 }),
    ).toBe(7);
  });

  it("passes through 9", () => {
    expect(
      dayWindowOrFallback({ dayWindow: 9, totalPosts: 7 }),
    ).toBe(9);
  });

  it("collapses unexpected numeric values back to the totalPosts-based fallback", () => {
    expect(
      dayWindowOrFallback({ dayWindow: 14, totalPosts: 7 }),
    ).toBe(7);
    expect(
      dayWindowOrFallback({ dayWindow: 14, totalPosts: 9 }),
    ).toBe(9);
  });
});

describe("postingDaysOrFallback", () => {
  it("returns every_day when stored value is NULL", () => {
    expect(postingDaysOrFallback({ postingDays: null })).toBe("every_day");
  });

  it.each<PostingDays>([
    "every_day",
    "working_days_only",
    "weekends_only",
  ])("passes through %s", (value) => {
    expect(postingDaysOrFallback({ postingDays: value })).toBe(value);
  });

  it("returns every_day for unrecognised strings", () => {
    expect(postingDaysOrFallback({ postingDays: "garbage" })).toBe("every_day");
  });
});
