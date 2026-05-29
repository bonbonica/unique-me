"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import {
  deselectForNetworkAction,
  selectForNetworkAction,
} from "@/app/(app)/(onboarded)/posts/actions";
import { WizardNav } from "@/components/posts/wizard-nav";
import { WizardStep } from "@/components/posts/wizard-step";
import { WizardSummary } from "@/components/posts/wizard-summary";
import type { SelectionPlatform } from "@/lib/schema";
import type { BatchForReview } from "@/lib/services/post-service";

/**
 * `/posts` wizard orchestrator. Steps are derived from the user's
 * `profiles.platforms` array — one wizard step per platform in canonical
 * `facebook → instagram → linkedin` order, plus a final summary step.
 *
 * Selection state lives here, NOT on the individual `<PostCard />`s, for
 * three reasons:
 *   1. The completed-step banner needs accurate live counts as the user
 *      toggles. Server-rendered `data.posts.selections` is stale the
 *      moment a checkbox is clicked.
 *   2. `<WizardSummary />` needs to reflect mid-wizard edits without a
 *      page refresh — same reason.
 *   3. Bulk actions ("Schedule all FB posts") have to flip 7 cards at
 *      once. Local per-card state can't coordinate that without prop
 *      drilling callbacks anyway, so lifting once is cleaner.
 *
 * Server writes happen via {@link selectForNetworkAction} /
 * {@link deselectForNetworkAction} inside a transition — the UI
 * updates synchronously via `setSelections` and the server catches up
 * within ~50-100ms. We don't await the network calls because optimistic
 * UI is the whole point of lifting state up.
 */
const PLATFORM_ORDER: SelectionPlatform[] = [
  "facebook",
  "instagram",
  "linkedin",
];

const NETWORK_LABELS: Record<SelectionPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

type SelectionsByPlatform = Record<SelectionPlatform, string[]>;

function initialSelections(data: BatchForReview): SelectionsByPlatform {
  const out: SelectionsByPlatform = {
    facebook: [],
    instagram: [],
    linkedin: [],
  };
  for (const post of data.posts) {
    for (const platform of post.selections) {
      out[platform].push(post.id);
    }
  }
  return out;
}

export function NetworkWizard({ data }: { data: BatchForReview }) {
  const platforms = PLATFORM_ORDER.filter((p) => data.platforms.includes(p));
  const totalSteps = platforms.length + 1;

  const [stepIndex, setStepIndex] = useState(0);
  const isSummary = stepIndex === platforms.length;
  const currentPlatform = isSummary ? null : platforms[stepIndex] ?? null;

  // The wizard's source of truth for which (post, platform) combos the
  // user has opted into. Initialized once from server data; updated by
  // the toggle/bulk callbacks below. The page-fetched `data.posts` stays
  // immutable here — it's the underlying content of each post, not the
  // user's selection decisions.
  const [selections, setSelections] = useState<SelectionsByPlatform>(() =>
    initialSelections(data)
  );
  const [, startTransition] = useTransition();

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

  function setSelection(
    postId: string,
    platform: SelectionPlatform,
    next: boolean
  ) {
    // Optimistic, synchronous client update.
    setSelections((prev) => {
      const set = new Set(prev[platform]);
      if (next) set.add(postId);
      else set.delete(postId);
      return { ...prev, [platform]: Array.from(set) };
    });
    // Fire-and-forget server write. We deliberately don't await — the UI
    // already shows the new state. If the server returns an error variant
    // (e.g., batch_locked from a racing tab), Phase 2 accepts the drift;
    // the next page load resyncs from the DB.
    startTransition(async () => {
      if (next) {
        await selectForNetworkAction(postId, platform);
      } else {
        await deselectForNetworkAction(postId, platform);
      }
    });
  }

  function selectAllForPlatform(platform: SelectionPlatform) {
    const allPostIds = data.posts.map((p) => p.id);
    setSelections((prev) => ({ ...prev, [platform]: allPostIds }));
    startTransition(async () => {
      // Parallel writes for all 7 posts. Each call is independently
      // idempotent (ON CONFLICT DO NOTHING in the service layer) so
      // re-running on top of existing selections is safe.
      await Promise.all(
        allPostIds.map((id) => selectForNetworkAction(id, platform))
      );
    });
  }

  function onBack() {
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function onNext() {
    setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
  }

  // A step is "completed" once the user has advanced past it. `Array.slice`
  // gives us the platforms whose step index is strictly less than the
  // current one. Going Back to a completed step naturally re-hides it
  // from the banner (because it's no longer behind the cursor).
  const completedPlatforms = platforms.slice(0, stepIndex);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <WizardHeader
        theme={data.batch.theme}
        importantThing={data.batch.importantThing}
        currentStep={stepIndex + 1}
        totalSteps={totalSteps}
      />

      {completedPlatforms.length > 0 ? (
        <CompletedBanner
          completedPlatforms={completedPlatforms}
          selections={selections}
        />
      ) : null}

      <WizardNav
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        isSummary={isSummary}
        onBack={onBack}
        onNext={onNext}
      />

      {currentPlatform ? (
        <WizardStep
          platform={currentPlatform}
          posts={data.posts}
          batchTheme={data.batch.theme}
          selections={selections}
          onSetSelection={setSelection}
          onSelectAllForPlatform={selectAllForPlatform}
          onAdvance={onNext}
        />
      ) : (
        <WizardSummary
          batch={data.batch}
          posts={data.posts}
          platforms={platforms}
          selections={selections}
          onSetSelection={setSelection}
        />
      )}

      <WizardNav
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        isSummary={isSummary}
        onBack={onBack}
        onNext={onNext}
      />
    </div>
  );
}

/**
 * Header for the wizard — theme + highlight from the batch, plus step
 * counter and progress dots. Extracted from the inline JSX so the parent
 * stays focused on orchestration.
 */
function WizardHeader({
  theme,
  importantThing,
  currentStep,
  totalSteps,
}: {
  theme: string;
  importantThing: string;
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <header className="space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            This week
          </p>
          <h1 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
            {theme}
          </h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </p>
      </div>
      <p className="text-sm text-muted-foreground leading-7 max-w-2xl">
        <span className="font-medium text-foreground">Highlight:</span>{" "}
        {importantThing}
      </p>
      <ProgressDots current={currentStep - 1} total={totalSteps} />
    </header>
  );
}

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

/**
 * Persistent confirmation banner shown above the step content on every
 * step the user has advanced past. Reads live counts from the wizard's
 * lifted selection state — so a user who goes Back to FB, unchecks
 * three, and advances again sees "✓ Facebook: 4 posts queued for summary"
 * instead of the original 7.
 *
 * Style: soft elevation `bg-card border shadow-soft`, champagne check
 * marks. Doesn't pin to viewport — scrolls with content. Per-user
 * feedback this is preferable to a position:sticky chip that fights with
 * the global SiteHeader / DashboardTopBar.
 */
function CompletedBanner({
  completedPlatforms,
  selections,
}: {
  completedPlatforms: SelectionPlatform[];
  selections: SelectionsByPlatform;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card px-4 py-3 shadow-soft space-y-1"
      role="status"
      aria-live="polite"
    >
      {completedPlatforms.map((platform) => {
        const count = selections[platform].length;
        return (
          <p key={platform} className="text-xs flex items-center gap-2">
            <Check className="size-3.5 text-primary shrink-0" aria-hidden />
            <span>
              <span className="font-medium">{NETWORK_LABELS[platform]}:</span>{" "}
              {count} {count === 1 ? "post" : "posts"} queued for summary
            </span>
          </p>
        );
      })}
    </div>
  );
}
