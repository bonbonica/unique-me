"use client";

import { useState } from "react";
import type { BatchForReview } from "@/lib/services/post-service";
import type { SelectionPlatform } from "@/lib/schema";
import { LockedSummary } from "@/components/posts/locked-summary";
import { WizardNav } from "@/components/posts/wizard-nav";
import { WizardStep } from "@/components/posts/wizard-step";
import { WizardSummary } from "@/components/posts/wizard-summary";

/**
 * `/posts` wizard orchestrator (Phase 2 task-08). Steps are derived from
 * the user's `profiles.platforms` array — exactly one wizard step per
 * platform the user picked during onboarding, plus a final summary step.
 *
 * The platform order is fixed (`facebook → instagram → linkedin`) so the
 * UX stays predictable regardless of how the array was stored.
 *
 * Selection state is DB-backed (`post_selections`), so the local
 * `stepIndex` state is the only thing this component owns. Going back-
 * and-forth re-reads the latest selections from the server-rendered
 * `data` prop — anything checked persists across navigation, anything
 * unchecked stays unchecked.
 *
 * This component is `"reviewing"`-only — the parent page (`posts/page.tsx`)
 * branches to {@link LockedSummary} when the batch is in `"scheduling"` or
 * `"cancelled"` state, so the wizard never sees those statuses.
 */
const PLATFORM_ORDER: SelectionPlatform[] = [
  "facebook",
  "instagram",
  "linkedin",
];

export function NetworkWizard({ data }: { data: BatchForReview }) {
  const platforms = PLATFORM_ORDER.filter((p) => data.platforms.includes(p));
  const totalSteps = platforms.length + 1;

  const [stepIndex, setStepIndex] = useState(0);
  const isSummary = stepIndex === platforms.length;
  const currentPlatform = isSummary ? null : platforms[stepIndex] ?? null;

  // Defensive: the parent page redirects to /onboarding when platforms is
  // empty, so this case shouldn't render here. Belt-and-braces.
  if (platforms.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-sm text-muted-foreground italic">
          No platforms selected in onboarding. Visit Settings to pick at
          least one network.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1 min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              This week
            </p>
            <h1 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
              {data.batch.theme}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of {totalSteps}
          </p>
        </div>
        <p className="text-sm text-muted-foreground leading-7 max-w-2xl">
          <span className="font-medium text-foreground">Highlight:</span>{" "}
          {data.batch.importantThing}
        </p>
        <ProgressDots current={stepIndex} total={totalSteps} />
      </header>

      {currentPlatform ? (
        <WizardStep
          platform={currentPlatform}
          posts={data.posts}
          batchTheme={data.batch.theme}
        />
      ) : (
        <WizardSummary
          batch={data.batch}
          posts={data.posts}
          platforms={platforms}
        />
      )}

      <WizardNav
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        isSummary={isSummary}
        onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
        onNext={() => setStepIndex((i) => Math.min(totalSteps - 1, i + 1))}
      />
    </div>
  );
}

/**
 * Tiny visual indicator above the step content. Two states per dot —
 * filled (current or visited), outline (upcoming). Cheaper to render than
 * a real progress bar and matches the spec's "progress dots" idea.
 */
function ProgressDots({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label={`Step ${current + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={
            i <= current
              ? "size-2 rounded-full bg-primary"
              : "size-2 rounded-full border border-border"
          }
          aria-hidden
        />
      ))}
    </div>
  );
}
