"use client";

// Wave 3 task-7 (onboarding-posting-preferences spec §5).
//
// "Posting days" card on `/settings`. Lets the user change their default
// posting cadence after onboarding — write target is
// `profiles.posting_days`, which seeds every new batch row but never
// retroactively shifts a past batch's calendar (`weekly_batches.posting_days`
// is frozen at creation, mirroring `post_length`).
//
// UI mirrors the onboarding form's posting-days control exactly (same pill
// classes, same option labels) so the two surfaces feel parallel — a user
// who set the preference during onboarding finds the same control in
// Settings. Card chrome matches `<PlanSection />` so the two cards stack
// without visual seam.
//
// Optimistic-update pattern: clicking a pill flips local state immediately
// and the preview line below recomputes from that state, so the response
// feels instant; the server action runs inside `useTransition` and we
// revert + toast on failure. Same shape as `<CancelBatchDialog />`'s
// `useTransition` block, adapted to a fire-and-forget toggle (no dialog).

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { updatePostingDaysAction } from "@/app/(app)/(onboarded)/settings/actions";
import { estimatePostsPerBatch } from "@/lib/scheduling/batch-calendar";
import type { SubscriptionPlan } from "@/lib/schema";
import { cn } from "@/lib/utils";

type PostingDaysValue =
  | "every_day"
  | "working_days_only"
  | "weekends_only";

type Props = {
  initial: PostingDaysValue;
  plan: SubscriptionPlan;
};

const POSTING_DAYS_OPTIONS: ReadonlyArray<{
  value: PostingDaysValue;
  label: string;
}> = [
  { value: "every_day", label: "Every day" },
  { value: "working_days_only", label: "Working days only" },
  { value: "weekends_only", label: "Weekends only" },
];

/**
 * Computes the `≈ N posts per batch` (or `≈ M–N posts per batch`) preview
 * line for the currently-selected option. Starter and trial users live
 * entirely on a 7-day window, so a single `estimatePostsPerBatch(7, …)`
 * call is enough. Pro users can hit a 9-day window on batch 4 of their
 * monthly cycle, so we union the 7-day and 9-day estimates to surface the
 * full range the user might see across the month.
 *
 * Uses an en-dash (U+2013) per spec §5; the `tabular-nums` class on the
 * caller stabilises width when the user toggles between options.
 */
function previewRange(
  value: PostingDaysValue,
  plan: SubscriptionPlan,
): { min: number; max: number } {
  const seven = estimatePostsPerBatch(7, value);
  if (plan !== "pro") {
    return seven;
  }
  const nine = estimatePostsPerBatch(9, value);
  return {
    min: Math.min(seven.min, nine.min),
    max: Math.max(seven.max, nine.max),
  };
}

export function PostingDaysSection({ initial, plan }: Props) {
  const headingId = useId();
  const [value, setValue] = useState<PostingDaysValue>(initial);
  const [pending, startTransition] = useTransition();

  function handleChange(next: PostingDaysValue) {
    // Clicking the already-selected pill is a no-op — avoids a needless
    // round-trip and a toast for a state that didn't actually change.
    if (next === value) return;

    // Capture the pre-flip value so we can revert if the action fails.
    // Reading from state inside the async callback would be racy if the
    // user clicked again before the action returned.
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await updatePostingDaysAction(next);
      if (result.ok) {
        toast.success("Posting days updated.");
        return;
      }
      // Any failure mode (unauthenticated / invalid / db_failed) collapses
      // to the same UX: a generic retry toast and revert. The user's
      // optimistic state is rolled back so the pill matches reality.
      setValue(previous);
      toast.error("Couldn't save posting days. Try again.");
    });
  }

  const { min, max } = previewRange(value, plan);
  const previewLabel =
    min === max
      ? `≈ ${min} posts per batch`
      : `≈ ${min}–${max} posts per batch`;

  return (
    <section className="bg-card rounded-2xl p-8 shadow-soft border border-border space-y-4">
      <p
        id={headingId}
        className="font-fraunces text-xl font-medium tracking-tight"
      >
        Posting days
      </p>
      <p className="text-sm text-muted-foreground leading-7">
        How often UniqueMe schedules posts inside each batch.
      </p>

      <div>
        <div
          role="radiogroup"
          aria-labelledby={headingId}
          className="inline-flex flex-wrap rounded-full bg-muted p-1 border border-border"
        >
          {POSTING_DAYS_OPTIONS.map((option) => {
            const selected = value === option.value;
            return (
              <label key={option.value} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="posting_days"
                  value={option.value}
                  checked={selected}
                  disabled={pending}
                  onChange={() => handleChange(option.value)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    "block px-5 py-2 rounded-full text-sm font-medium transition-colors duration-200",
                    "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/30 peer-focus-visible:outline-none",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent/40",
                  )}
                >
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Applies to your next batch. Current batches stay as planned.
        </p>
      </div>

      <p className="text-sm text-muted-foreground leading-7 tabular-nums">
        {previewLabel}
      </p>
    </section>
  );
}
