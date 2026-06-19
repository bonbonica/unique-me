"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Back / Next navigation footer used by {@link NetworkWizard}.
 *
 * - Back is disabled on step 1.
 * - On steps 1..N-1: renders Next on the right.
 * - On the summary step: renders `summaryAction` on the right if provided
 *   (the parent passes the "Schedule my pick" button so the commit CTA
 *   sits in the same top-right slot as Next on prior steps). If
 *   `summaryAction` is omitted, the right side is empty.
 *
 * Selection state is DB-backed via `post_selections`, so navigating
 * back-and-forth doesn't lose any user input.
 */
export function WizardNav({
  stepIndex,
  isSummary,
  onBack,
  onNext,
  summaryAction,
}: {
  stepIndex: number;
  totalSteps: number;
  isSummary: boolean;
  onBack: () => void;
  onNext: () => void;
  summaryAction?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-6">
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        disabled={stepIndex === 0}
        className="gap-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Button>

      {isSummary ? (
        summaryAction ?? null
      ) : (
        <Button type="button" onClick={onNext} className="gap-2">
          Next
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
