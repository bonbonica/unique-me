"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  deselectForNetworkAction,
  getBatchImageStatusesAction,
  regenerateImageAction,
  rescheduleAction,
  retryImageAction,
  scheduleMyPickAction,
  selectForNetworkAction,
} from "@/app/(app)/(onboarded)/posts/actions";
import { WizardNav } from "@/components/posts/wizard-nav";
import { WizardStep } from "@/components/posts/wizard-step";
import { WizardSummary } from "@/components/posts/wizard-summary";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * plain confident verbs.
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
 * Wave 2 Stage 4 sibling of {@link retryReasonCopy} for regenerate codes.
 * `pro_required` is a Pro-gate rejection — the client-side tile hides the
 * icon for non-Pro users so this should be rare, but defense-in-depth.
 */
function regenerateReasonCopy(reason: string): string {
  switch (reason) {
    case "not_owned":
      return "You don't have access to this image.";
    case "not_successful":
      return "This image was already updated. Refresh to see the latest.";
    case "attempts_exhausted":
      return "No more attempts left for this image.";
    case "already_in_progress":
      return "Already regenerating — give it a moment.";
    case "pro_required":
      return "Regenerating an image is a Pro feature.";
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
  isPro,
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
  /**
   * Image-generation Wave 2 Stage 4: whether the current user is on the
   * Pro plan with an active subscription. Resolved server-side in the
   * parent page and threaded down so the tile can decide whether to
   * render the corner regenerate icon. The server action gates
   * regardless; this prop only suppresses the affordance for non-Pro
   * users so they don't see something they can't use.
   */
  isPro: boolean;
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

  // Image-generation Wave 2 Stage 4: set of postIds with an in-flight
  // regenerate. Populated by `handleRegenerate` on click; consumed by the
  // polling tick once the row transitions to `success` with attempt=2 so
  // the user gets a success toast. Pre-allowOverwrite this was a Map keyed
  // by the pre-click imageUrl so we could detect a server-side revert by
  // URL equality — but with the new `allowOverwrite: true` blob upload the
  // regen-success path rewrites the SAME blob URL, making URL equality
  // always true. We trust the lifecycle alone now; the rare regen-failure
  // path falls through to a misleading "Image regenerated." toast but
  // preserves the original image visually, which is the dominant signal
  // the user cares about. Distinguishing success from failure cleanly
  // requires a server-side schema/return-shape change (out of scope here).
  const regeneratesInFlightRef = useRef<Set<string>>(new Set());

  // Schedule state lifted up from <WizardSummary /> so the commit button
  // can render inside <WizardNav /> at the top-right corner — the same
  // slot Next occupies on steps 1..N-1. <WizardSummary /> below is now a
  // pure presentation of the selected cards; this section owns the
  // submitting / error / disclaimer surface that previously lived inside
  // the summary's own button blocks. Declared next to the other top-level
  // hooks so we satisfy the rules-of-hooks invariant — the
  // `platforms.length === 0` early-return below sits AFTER all hook
  // calls.
  const router = useRouter();
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // One-time disclaimer fired at whole-batch scheduling completion (the
  // reviewing → scheduling OR cancelled → scheduling transition). Opens
  // once when the action returns ok; dismissing it routes the user to
  // /posting-soon where the freshly-scheduled posts now live in the
  // network tabs. NOT per-post — only at this one batch-level transition.
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  // Wave 2 polling-restart fix: derived from the CURRENT `images` state, not
  // the initial SSR `data.images`. When a user clicks retry/regenerate AFTER
  // all Wave 1 tiles have already settled, the optimistic local flip to
  // 'generating' / 'regenerating' transitions this boolean false→true, the
  // polling useEffect re-runs (deps changed), and a fresh interval starts.
  // Without this, the effect mounted once with `anyPending=false` and never
  // restarted — the new image landed in the DB but the tile sat in the
  // optimistic state until a manual refresh.
  const pollingNeeded = anyPending(images);

  useEffect(() => {
    // No pending work at this render — either Wave 1 finished before the
    // user arrived, or a tick just completed the last in-flight job. Either
    // way, no interval is needed until `pollingNeeded` flips back to true.
    if (!pollingNeeded) return;

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

        // Wave 2 Stage 4: detect regenerate completions BEFORE applying the
        // poll update so the user gets a success toast at the moment the
        // tile flips out of "regenerating". Both outcomes (success and
        // revert-to-original) land as status="success" + attempt=2 and now
        // — under allowOverwrite — also share the same `imageUrl`, so the
        // lifecycle transition is the only signal we have. We assume
        // success (the dominant path) and accept the trade-off described
        // on `regeneratesInFlightRef`.
        for (const postId of regeneratesInFlightRef.current) {
          const freshTile = fresh[postId];
          if (
            freshTile &&
            freshTile.status === "success" &&
            freshTile.attempt === 2
          ) {
            toast.success("Image regenerated.");
            regeneratesInFlightRef.current.delete(postId);
          }
        }

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
    // `pollingNeeded` is the only state-derived dep — the effect re-runs
    // when transitioning between "all terminal" and "some pending". The
    // tick body still reads the latest `images` via `imagesRef` so we
    // don't tear down the interval on every individual status update.
  }, [data.batch.id, pollingNeeded]);

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

  /**
   * Wave 2 Stage 4 regenerate handler. Pro-only on the UI surface; the
   * server enforces the tier gate regardless. Optimistic flip to
   * `regenerating` keeps the original `imageUrl` visible (dimmed) so the
   * user never sees a skeleton flash. On rejection we revert. On accept
   * we mark the postId as in-flight so the polling tick can fire a
   * success toast when the row flips back to `success` at attempt=2.
   */
  async function handleRegenerate(postId: string) {
    const current = imagesRef.current[postId];
    if (
      !current ||
      current.status !== "success" ||
      current.attempt >= 2 ||
      !current.imageUrl
    ) {
      return;
    }
    const postImageId = current.id;

    setImages((prev) => {
      const existing = prev[postId];
      if (
        !existing ||
        existing.status !== "success" ||
        !existing.imageUrl
      ) {
        return prev;
      }
      return {
        ...prev,
        [postId]: { ...existing, status: "regenerating", attempt: 2 },
      };
    });

    // Mark this tile as having an in-flight regenerate so the polling tick
    // can surface a success toast at the lifecycle transition. We no longer
    // store the pre-click URL — `allowOverwrite` keeps the URL stable, so
    // URL-equality comparisons can't distinguish success from server-side
    // revert. See `regeneratesInFlightRef`'s docblock for the trade-off.
    regeneratesInFlightRef.current.add(postId);

    const revert = () => {
      setImages((prev) => {
        const existing = prev[postId];
        if (!existing || existing.status !== "regenerating") return prev;
        return {
          ...prev,
          [postId]: { ...existing, status: "success", attempt: 1 },
        };
      });
      regeneratesInFlightRef.current.delete(postId);
    };

    try {
      const result = await regenerateImageAction(postImageId);
      if (!result.ok) {
        revert();
        toast.error(regenerateReasonCopy(result.reason));
      }
    } catch (err) {
      console.error("[network-wizard] regenerateImageAction threw", err);
      revert();
      toast.error(regenerateReasonCopy("network"));
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

  // Schedule labels derived from mode. State for submitting / error /
  // disclaimer is declared with the other hooks above so we stay on the
  // safe side of the `platforms.length === 0` early return.
  const isCancelled = mode === "cancelled";
  const ctaText = isCancelled ? "Schedule" : "Schedule my pick";
  const totalSelectionCount =
    selections.facebook.length +
    selections.instagram.length +
    selections.linkedin.length;
  const isEmpty = totalSelectionCount === 0;

  async function handleSchedule() {
    setScheduleSubmitting(true);
    setScheduleError(null);
    const result = isCancelled
      ? await rescheduleAction(data.batch.id)
      : await scheduleMyPickAction(data.batch.id);
    if (result.ok) {
      setDisclaimerOpen(true);
    } else {
      setScheduleError(scheduleErrorCopy(result.error));
      setScheduleSubmitting(false);
    }
  }

  function handleDisclaimerClose(next: boolean) {
    if (next) return;
    setDisclaimerOpen(false);
    // Route to /posting-soon — the freshly-scheduled posts now live in
    // its per-network tabs. Replaces the previous router.refresh() which
    // landed the user on /schedule-posts/[batchId]'s LockedSummary; that
    // view is no longer the natural destination after a commit.
    router.push("/posting-soon");
  }

  const scheduleButton = isSummary ? (
    <Button
      type="button"
      onClick={handleSchedule}
      disabled={scheduleSubmitting || isEmpty}
      className="gap-2 rounded-full glow-champagne"
    >
      {scheduleSubmitting ? (
        <>
          <Loader2 className="animate-spin size-4" aria-hidden />
          Scheduling…
        </>
      ) : (
        <>
          <CheckSquare className="size-4" aria-hidden />
          {ctaText}
        </>
      )}
    </Button>
  ) : null;

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
        summaryAction={scheduleButton}
      />

      {/* Inline schedule error renders directly under the top nav so the
          user sees feedback near the button that triggered it. */}
      {isSummary && scheduleError ? (
        <p role="alert" className="text-destructive text-sm">
          {scheduleError}
        </p>
      ) : null}

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
          isPro={isPro}
          onImageRegenerate={handleRegenerate}
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
          isPro={isPro}
          onImageRegenerate={handleRegenerate}
        />
      )}

      <WizardNav
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        isSummary={isSummary}
        onBack={onBack}
        onNext={onNext}
        summaryAction={scheduleButton}
      />

      {/* One-time disclaimer fired at the reviewing → scheduling OR
          cancelled → scheduling transition. Dismissing it routes the
          user to /posting-soon where the freshly-scheduled posts now
          live. */}
      <Dialog open={disclaimerOpen} onOpenChange={handleDisclaimerClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
              Check your posts regularly
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-base leading-7 text-muted-foreground">
            Social media partners occasionally update their systems, which
            may affect automated publishing.
          </DialogDescription>
          <DialogFooter>
            <Button onClick={() => handleDisclaimerClose(false)}>
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function scheduleErrorCopy(err: string): string {
  switch (err) {
    case "no_selections":
      return "Pick at least one post-network combination first.";
    case "batch_already_locked":
      return "This batch is already scheduled or cancelled.";
    case "not_owned":
      return "You don't have access to this batch.";
    case "not_found":
      return "Batch not found.";
    case "db_failed":
      return "Couldn't save your selections. Try again.";
    default:
      return "Something went wrong. Try again.";
  }
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
