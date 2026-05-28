"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Back / Next navigation footer used by {@link NetworkWizard}.
 *
 * - Back is disabled on step 1.
 * - Next is hidden on the summary step entirely — the summary renders its
 *   own primary "Schedule my pick" action via {@link WizardSummary}, so a
 *   Next button would be redundant.
 *
 * Selection state is DB-backed via `post_selections`, so navigating
 * back-and-forth doesn't lose any user input.
 */
export function WizardNav({
  stepIndex,
  isSummary,
  onBack,
  onNext,
}: {
  stepIndex: number;
  totalSteps: number;
  isSummary: boolean;
  onBack: () => void;
  onNext: () => void;
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

      {!isSummary ? (
        <Button type="button" onClick={onNext} className="gap-2">
          Next
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
