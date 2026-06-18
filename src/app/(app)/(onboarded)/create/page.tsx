import { headers } from "next/headers";
import {
  CreateHubFormProvider,
  CreateHubFormSlot,
  CreateHubStartNewBatchButton,
} from "@/components/create/create-hub-form-slot";
import type { DeleteWarning } from "@/components/create/delete-batch-forever-dialog";
import { QuotaGatedScreen } from "@/components/create/quota-gated-screen";
import { TrialGatedScreen } from "@/components/create/trial-gated-screen";
import { TrialNote } from "@/components/create/trial-note";
import { UnscheduledBatchList } from "@/components/create/unscheduled-batch-list";
import { auth } from "@/lib/auth";
import { type Profile } from "@/lib/schema";
import {
  postService,
  profileService,
  subscriptionService,
} from "@/lib/services";
import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";

/**
 * `/create` — the **Create Posts hub** (spec § 6.9, D-S2 / D-S14).
 *
 * Hub structure (one container, vertical slots):
 *
 *   1. Header — `"Create Posts"` (Fraunces) + optional `<TrialNote />`.
 *   2. `<UnscheduledBatchList />` — top buttons row, then the form (or gated
 *      screen) directly under the buttons via the `belowButtonsSlot` prop,
 *      then the stacked cards for any batches in `reviewing` / `cancelled`.
 *      The order puts the create-new-posts action ABOVE existing batches so
 *      the form expands next to the button that triggers it rather than
 *      below the user's cancelled cards. Self-hides when there are zero
 *      cards AND no `startNewBatchSlot` injected — see fresh-state branch
 *      below.
 *   3. **Fresh state only** — when there are zero cards and the user can
 *      create, `<UnscheduledBatchList />` returns null and the form
 *      (`belowSlot`) is rendered directly under the header so it takes the
 *      full frame.
 *
 * The collapse rule (D-S14): when 1+ cards exist + the user can generate,
 * the form starts collapsed and the top `[Start new batch]` button toggles
 * it. When zero cards exist + the user can generate, the form is expanded
 * by default so fresh-state users see it immediately. Gate screens take
 * the form's slot exactly as before.
 *
 * All five `canGenerate` reason codes (`trial_batch_exists`,
 * `weekly_cap_active`, `monthly_cap_active`, `starter_platforms_overage`,
 * `plan_inactive`) are preserved. None of them are new in this redesign —
 * the hub is a render-time concern (spec D-S17).
 *
 * Placeholder personalisation reads the profile's `websiteAnalysis` blob
 * (populated during onboarding) for `suggestedTopics` /
 * `uniqueSellingPoints`. Users who completed onboarding without a website
 * (or whose scrape failed) fall through to a businessType-aware default
 * set. No AI call here — everything's derived synchronously from data we
 * already have on the profile row.
 */
export default async function CreatePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const subscription = await subscriptionService.checkSubscription(
    session.user.id,
  );
  const cards = await postService.getUnscheduledBatchesForUser(session.user.id);
  // Tier-aware copy context for `<DeleteBatchForeverDialog />` — derived
  // once from the snapshot the page already loaded (no extra service call).
  // Threaded through the list/card/trigger to the dialog; see
  // specs/delete-warning/spec.md §3.
  const deleteWarning = deriveDeleteWarning(subscription);

  // The three locals the final return composes. `belowSlot` is the
  // form-OR-gated-screen rendered under the cards; `canStartNew` controls
  // whether the top "Start new batch" affordance is interactive (and
  // whether we even inject a custom button slot at all); `capacityTooltip`
  // is the disabled-button title text on the at-cap paths.
  let belowSlot: React.ReactNode;
  let canStartNew = false;
  let capacityTooltip: string | undefined;

  // Gate (D20): trial + any batch (incl. cancelled) → upgrade screen.
  // We use getMostRecentBatch (any status) rather than the previous
  // hasAnyBatch + getCurrentBatch combo so the gated screen can deep-link
  // back to a cancelled batch — the cancelled-recoverable flow needs the
  // user to be able to find their batch again, and getCurrentBatch
  // intentionally hides cancelled.
  if (subscription.status === "trial") {
    const mostRecent = await postService.getMostRecentBatch(session.user.id);
    if (mostRecent) {
      belowSlot = (
        <TrialGatedScreen
          existingBatchId={mostRecent.id}
          batchStatus={mostRecent.status}
        />
      );
      capacityTooltip = "Trial includes one batch.";
    }
  }

  // Paid-user gate (Phase 3 task-07). The trial branch above handles the
  // cancelled-recoverable nuance that `<QuotaGatedScreen />` deliberately
  // doesn't replicate, so canGenerate only fires for non-trial users here.
  // The 4-reason union (D13) maps 1:1 to the QuotaGatedScreen variants;
  // `trial_batch_exists` is unreachable in this position but kept in the
  // switch for exhaustiveness so a future canGenerate change can't
  // silently fall through.
  if (!belowSlot) {
    const gate = await subscriptionService.canGenerate(session.user.id);
    if (!gate.allowed) {
      switch (gate.reason) {
        case "weekly_cap_active":
          belowSlot = (
            <QuotaGatedScreen variant="quota" nextResetAt={gate.nextResetAt} />
          );
          capacityTooltip = "You've used all batches this period.";
          break;
        case "monthly_cap_active":
          // Temporary: reuses the weekly_cap_active "quota" variant so the
          // wave compiles. Task 13 (Wave 4) introduces a dedicated
          // `variant="monthly_quota"` with the 4-of-4-batches copy + the
          // `batchesUsed` field; swap this arm there.
          belowSlot = (
            <QuotaGatedScreen variant="quota" nextResetAt={gate.nextResetAt} />
          );
          capacityTooltip = "You've used all batches this period.";
          break;
        case "starter_platforms_overage":
          belowSlot = (
            <QuotaGatedScreen
              variant="overage"
              currentCount={gate.currentCount}
            />
          );
          capacityTooltip = "Reduce your platforms in Settings to continue.";
          break;
        case "plan_inactive":
          belowSlot = <QuotaGatedScreen variant="inactive" />;
          capacityTooltip = "Your plan is inactive.";
          break;
        case "trial_batch_exists":
          // Unreachable — the explicit trial branch above already set
          // belowSlot. Kept in the switch for exhaustiveness so a future
          // canGenerate change can't silently fall through.
          break;
      }
    } else {
      canStartNew = true;
      const profile = await profileService.getProfile(session.user.id);
      const themePlaceholder = computeThemePlaceholder(profile);
      const importantThingPlaceholder =
        computeImportantThingPlaceholder(profile);
      belowSlot = (
        <CreateHubFormSlot
          themePlaceholder={themePlaceholder}
          importantThingPlaceholder={importantThingPlaceholder}
          hasProFeatures={subscriptionService.hasProFeatures(subscription)}
        />
      );
    }
  }

  const daysLeft = subscription.daysLeftInTrial;
  const showTrialNote =
    subscription.status === "trial" && daysLeft !== null && daysLeft > 0;

  // Collapse rule (D-S14):
  //   - 1+ cards + form allowed → form starts collapsed; top button opens it.
  //   - 0 cards + form allowed → form starts expanded; no top button.
  // Gated paths don't render the form at all, so this flag is irrelevant
  // for them.
  const initiallyExpanded = canStartNew && cards.length === 0;

  return (
    <CreateHubFormProvider initiallyExpanded={initiallyExpanded}>
      <div className="max-w-3xl mx-auto space-y-12">
        <header className="space-y-3">
          <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
            Create Posts
          </h1>
          {showTrialNote ? <TrialNote daysLeft={daysLeft} /> : null}
        </header>

        <UnscheduledBatchList
          cards={cards}
          hasCapacity={canStartNew}
          warning={deleteWarning}
          {...(capacityTooltip !== undefined ? { capacityTooltip } : {})}
          {...(canStartNew && cards.length > 0
            ? { startNewBatchSlot: <CreateHubStartNewBatchButton /> }
            : {})}
          belowButtonsSlot={belowSlot}
        />

        {/*
          Fresh-state fallback: when there are zero cards AND no startNewBatchSlot
          is injected, `<UnscheduledBatchList />` returns null (it has no
          buttons row to render) and the form needs to render here directly so
          it still appears on the page. In the cards-present path the list
          already rendered the form via `belowButtonsSlot` above, so this
          branch is a no-op.
        */}
        {cards.length === 0 && belowSlot}
      </div>
    </CreateHubFormProvider>
  );
}

// =============================================================================
// Placeholder personalisation
// =============================================================================

/**
 * Theme-field placeholder: pulls 2-3 entries from `suggestedTopics` if the
 * scrape ran during onboarding; otherwise falls back to a businessType-aware
 * default. Used as the `<Input placeholder>` so it disappears the moment
 * the user starts typing — never as a default form value.
 */
function computeThemePlaceholder(profile: Profile | null): string {
  const topics = profile?.websiteAnalysis?.suggestedTopics;
  if (topics && topics.length > 0) {
    return `e.g. ${topics.slice(0, 3).join(", ")}`;
  }
  return businessTypeThemeDefault(profile?.businessType);
}

/**
 * Important-thing placeholder: same idea as the theme placeholder but
 * pulls from `uniqueSellingPoints` (a single short phrase reads better
 * here than a list, and it nudges the user to think about what's
 * specifically meaningful this week).
 */
function computeImportantThingPlaceholder(profile: Profile | null): string {
  const usps = profile?.websiteAnalysis?.uniqueSellingPoints;
  if (usps && usps.length > 0 && usps[0]) {
    return `e.g. ${usps[0]}`;
  }
  return businessTypeImportantDefault(profile?.businessType);
}

/**
 * Business-type-aware theme fallbacks for users who skipped the website
 * step or whose scrape returned nothing. Kept as a lookup table rather
 * than an AI call so the page renders synchronously and adds zero latency.
 * Phrasing mirrors how a small-business owner actually talks about their
 * own week — short, concrete, no marketing jargon.
 */
function businessTypeThemeDefault(type: string | undefined): string {
  switch (type) {
    case "Restaurant/Food":
      return "e.g. seasonal menus, weekend specials, the new chef";
    case "Real Estate":
      return "e.g. new listings, open house weekend, market trends";
    case "Retail/Shop":
      return "e.g. new arrivals, seasonal favourites, gift ideas";
    case "Beauty/Salon":
      return "e.g. summer hair colour, the new lash service, bridal looks";
    case "Health and Wellness":
    case "Health":
      return "e.g. winter immunity, the new movement class, daily nutrition";
    case "Fitness":
      return "e.g. beginner-friendly workouts, race-prep week, recovery basics";
    case "Education":
      return "e.g. study tips for finals, the new course, parent open day";
    case "Coaching":
      return "e.g. goal-setting week, time-management tools, mindset shifts";
    case "Tech":
      return "e.g. product launch, customer use cases, the new integration";
    case "Professional Services":
      return "e.g. case study highlights, behind-the-scenes, FAQs";
    default:
      return "e.g. this week's theme, your seasonal hook, the big story";
  }
}

function businessTypeImportantDefault(type: string | undefined): string {
  switch (type) {
    case "Restaurant/Food":
      return "e.g. the new tasting menu launches Friday";
    case "Real Estate":
      return "e.g. only three listings left in this neighbourhood";
    case "Retail/Shop":
      return "e.g. the holiday collection drops next week";
    case "Beauty/Salon":
      return "e.g. our new colour treatment is bookable from Monday";
    case "Health and Wellness":
    case "Health":
      return "e.g. how to keep momentum through the winter slump";
    case "Fitness":
      return "e.g. why active recovery matters between sessions";
    case "Education":
      return "e.g. the early-bird enrolment closes this Friday";
    case "Coaching":
      return "e.g. the framework I use with every client this week";
    case "Tech":
      return "e.g. the new integration ships Wednesday";
    case "Professional Services":
      return "e.g. why this case study matters for businesses like yours";
    default:
      return "e.g. the angle that makes this week worth posting about";
  }
}

// =============================================================================
// Delete-warning derivation (specs/delete-warning/spec.md §3)
// =============================================================================

/**
 * Pick the tier-aware copy context for `<DeleteBatchForeverDialog />` off
 * the existing subscription snapshot. Pure synchronous transformation —
 * no service call, no DB hit. Called once per `/create` render.
 *
 * The `starter` variant's `nextAvailable` is intentionally nullable. A null
 * value means "we don't know the next-available date, so don't print one" —
 * the dialog renders the neutral Starter copy (no date claim). We never
 * substitute `new Date()` or any other placeholder: fabricating a date the
 * user can hold us to would be worse than omitting it. See spec §3
 * "Why nullable instead of a sentinel".
 *
 * Branch order:
 *   1. Trial (`status === "trial"`, regardless of `plan`).
 *   2. Active Pro with `proQuota` populated → at-cap vs under-cap split.
 *   3. Active Starter → date may be null on the no-prior-batch path.
 *   4. Inactive paid plans → falls through as Starter-shaped with whatever
 *      `nextResetAt` carries (typically `null` for inactive); the dialog
 *      renders the neutral Starter copy. No fifth variant per spec §3.
 */
function deriveDeleteWarning(
  snapshot: SubscriptionStateSnapshot,
): DeleteWarning {
  if (snapshot.status === "trial") {
    return { tier: "trial" };
  }

  if (snapshot.plan === "pro" && snapshot.proQuota) {
    if (snapshot.proQuota.used >= snapshot.proQuota.max) {
      return {
        tier: "pro_at_cap",
        nextAvailable: snapshot.proQuota.periodEndsAt,
      };
    }
    return {
      tier: "pro_under_cap",
      remaining: snapshot.proQuota.max - snapshot.proQuota.used,
    };
  }

  if (snapshot.plan === "starter" && snapshot.status === "active") {
    return { tier: "starter", nextAvailable: snapshot.nextResetAt };
  }

  // Inactive paid plans (cancelled/expired Starter or Pro). `nextResetAt`
  // returns null on the inactive branch — passed through so the dialog
  // renders the neutral Starter copy without a fabricated date.
  return { tier: "starter", nextAvailable: snapshot.nextResetAt };
}
