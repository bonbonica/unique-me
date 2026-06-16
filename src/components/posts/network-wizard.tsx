"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import {
  deselectForNetworkAction,
  getBatchImageStatusesAction,
  retryImageAction,
  selectForNetworkAction,
} from "@/app/(app)/(onboarded)/posts/actions";
import { WizardNav } from "@/components/posts/wizard-nav";
import { WizardStep } from "@/components/posts/wizard-step";
import { WizardSummary } from "@/components/posts/wizard-summary";
import {
  dayWindowOrFallback,
  postingDaysOrFallback,
} from "@/lib/scheduling/batch-calendar";
import type { SelectionPlatform } from "@/lib/schema";
import type {
  BatchForReview,
  PostImageStatus,
} from "@/lib/services/post-service";

/**
 * Image-generation Wave 1 Stage 5: polling cadence for the per-post image
 * status. 2.5s strikes the balance between "user sees the tile fill in
 * within ~one breath of it finishing" and "we don't hammer the DB while
 * the user sits on the page". Generation typically lands in 10-60s for a
 * 7-post batch (one OpenAI image takes 3-15s; p-limit=3 means 3 waves
 * worst-case), so a handful of polls cover the whole window.
 */
const IMAGE_POLL_INTERVAL_MS = 2500;

function anyPending(images: Record<string, PostImageStatus>): boolean {
  for (const img of Object.values(images)) {
    if (
      img.status === "pending" ||
      img.status === "generating" ||
      img.status === "regenerating"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Wave 2 Stage 3: map server reason codes from {@link retryImageAction} to
 * user-facing toast copy. Voice follows DESIGN.md §14: no exclamation points,
 * plain confident verbs. Single source of truth so retry + (future Stage 4)
 * regenerate handlers don't drift from each other.
 */
function retryReasonCopy(reason: string): string {
  switch (reason) {
    case "not_owned":
      return "You don't have access to this image.";
    case "not_failed":
      return "This image was already updated. Refresh to see the latest.";
    case "attempts_exhausted":
      return "No more attempts left for this image.";
    case "already_in_progress":
      return "Already retrying — give it a moment.";
    default:
      return "Something went wrong. Try again in a moment.";
  }
}

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
 *   3. Bulk actions ("Schedule all FB posts") have to flip every card in
 *      the batch (7 or 9, depending on `batch.totalPosts`) at once.
 *      Local per-card state can't coordinate that without prop drilling
 *      callbacks anyway, so lifting once is cleaner.
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

export function NetworkWizard({
  data,
  mode = "reviewing",
}: {
  data: BatchForReview;
  /**
   * `"reviewing"` is the normal pre-commit wizard flow.
   *
   * `"cancelled"` enables the cancelled-recoverable surface (partial Item
   * 6): same wizard mechanics, but the summary commits via
   * `rescheduleAction` instead of `scheduleMyPickAction`, copy adapts
   * ("Re-schedule" / "Re-schedule your week"), and the per-card
   * Regenerate button is hidden (no AI re-rolls in cancelled mode).
   */
  mode?: "reviewing" | "cancelled";
}) {
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

  // Image-generation Wave 1 Stage 5: per-post image status. SSR loads the
  // initial map via `getBatchForReview`; client polling keeps it fresh as
  // pending rows finish. The ref carries the latest value into the interval
  // callback so we don't have to rebind the effect on every state change —
  // synced from state via a no-deps effect (writing the ref during render
  // would trigger React's "Cannot access refs during render" warning).
  const [images, setImages] = useState<Record<string, PostImageStatus>>(
    () => data.images,
  );
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  });

  useEffect(() => {
    // Skip the poll entirely if every row is already terminal (page was
    // opened after all images had landed).
    if (!anyPending(data.images)) return;

    let cancelled = false;

    const tick = async () => {
      // Always re-check via the ref so we observe the latest state, not
      // the value captured when this interval started. Once all rows
      // terminate, clear the interval so we stop hitting the server.
      if (!anyPending(imagesRef.current)) {
        clearInterval(intervalId);
        return;
      }
      try {
        const fresh = await getBatchImageStatusesAction(data.batch.id);
        if (cancelled) return;
        setImages((prev) => ({ ...prev, ...fresh }));
      } catch (err) {
        // Transient network errors shouldn't kill the loop — the next
        // tick will try again. The 2.5s cadence caps the churn.
        console.error("[network-wizard] image-status poll failed", err);
      }
    };

    const intervalId = setInterval(tick, IMAGE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // We deliberately depend ONLY on batch.id (the URL the polling is
    // tied to) so the interval isn't torn down on every state update.
    // The tick reads the latest `images` via `imagesRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.batch.id]);

  /**
   * Wave 2 Stage 3 retry handler. Optimistically flips the tile to the
   * `generating` skeleton, fires the server action, and reverts on failure
   * with a toast. Concurrency safety lives at the server (conditional
   * UPDATE); this handler just keeps the UI honest in the meantime.
   *
   * Guards re-check the slot via `imagesRef` so a double-click can't
   * decrement attempt back to 1 on a race — only the first invocation
   * passes the `status === "failed"` gate.
   */
  async function handleRetry(postId: string) {
    const current = imagesRef.current[postId];
    if (!current || current.status !== "failed" || current.attempt >= 2) {
      return;
    }
    const postImageId = current.id;

    setImages((prev) => {
      const existing = prev[postId];
      if (!existing || existing.status !== "failed") return prev;
      return {
        ...prev,
        [postId]: { ...existing, status: "generating", attempt: 2 },
      };
    });

    const revert = () =>
      setImages((prev) => {
        const existing = prev[postId];
        if (!existing || existing.status !== "generating") return prev;
        return {
          ...prev,
          [postId]: { ...existing, status: "failed", attempt: 1 },
        };
      });

    try {
      const result = await retryImageAction(postImageId);
      if (!result.ok) {
        revert();
        toast.error(retryReasonCopy(result.reason));
      }
    } catch (err) {
      console.error("[network-wizard] retryImageAction threw", err);
      revert();
      toast.error(retryReasonCopy("network"));
    }
  }

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
      // Parallel writes for every post in the batch. Each call is
      // independently idempotent (ON CONFLICT DO NOTHING in the service
      // layer) so re-running on top of existing selections is safe.
      await Promise.all(
        allPostIds.map((id) => selectForNetworkAction(id, platform))
      );
    });
  }

  function deselectAllForPlatform(platform: SelectionPlatform) {
    // Snapshot which posts ARE selected right now (the server actions
    // will need this list — Set membership doesn't survive into the
    // transition closure cleanly). Empty after the optimistic clear, so
    // we have to capture before mutating.
    const previouslySelected = selections[platform].slice();
    setSelections((prev) => ({ ...prev, [platform]: [] }));
    startTransition(async () => {
      await Promise.all(
        previouslySelected.map((id) =>
          deselectForNetworkAction(id, platform)
        )
      );
    });
  }

  function onBack() {
    setStepIndex((i) => Math.max(0, i - 1));
  }
  function onNext() {
    setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
  }

  // The banner is driven by ACTUAL selection state, not navigation history.
  // A platform shows up here if the user has at least one selection for it
  // — independent of which step they're currently on. Going Back from IG
  // to FB doesn't change the banner; only un-ticking checkboxes does.
  const platformsWithSelections = platforms.filter(
    (p) => selections[p].length > 0
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <WizardHeader
        theme={data.batch.theme}
        importantThing={data.batch.importantThing}
        currentStep={stepIndex + 1}
        totalSteps={totalSteps}
      />

      {platformsWithSelections.length > 0 ? (
        <SelectionsBanner
          platforms={platformsWithSelections}
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
          batchCreatedAt={data.batch.createdAt}
          dayWindow={dayWindowOrFallback(data.batch)}
          postingDays={postingDaysOrFallback(data.batch)}
          selections={selections}
          onSetSelection={setSelection}
          onSelectAllForPlatform={selectAllForPlatform}
          onDeselectAllForPlatform={deselectAllForPlatform}
          mode={mode}
          images={images}
          onImageRetry={handleRetry}
        />
      ) : (
        <WizardSummary
          batch={data.batch}
          posts={data.posts}
          platforms={platforms}
          selections={selections}
          onSetSelection={setSelection}
          mode={mode}
          images={images}
          onImageRetry={handleRetry}
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
 * Live confirmation banner — shows one row per network that has at least
 * one post selected. Reads counts straight from the wizard's lifted
 * selection state, so:
 *   - Tick a checkbox → count goes up immediately.
 *   - Un-tick → count goes down.
 *   - Un-tick the last one for a network → that row vanishes.
 *   - Un-tick the last selection across all networks → banner disappears.
 *   - Back / Next navigation has zero effect on the banner.
 *
 * Style: soft elevation `bg-card border shadow-soft`, champagne check
 * marks. Doesn't pin to viewport — scrolls with content. We previously
 * tried `position: sticky` and it fought with the global SiteHeader /
 * DashboardTopBar; this placement (above the step content, scrolling
 * normally) is the durable answer.
 */
function SelectionsBanner({
  platforms,
  selections,
}: {
  platforms: SelectionPlatform[];
  selections: SelectionsByPlatform;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-card px-4 py-3 shadow-soft space-y-1"
      role="status"
      aria-live="polite"
    >
      {platforms.map((platform) => {
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
