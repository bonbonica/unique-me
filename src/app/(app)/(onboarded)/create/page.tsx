import { headers } from "next/headers";
import { CreateTrialButton } from "@/components/create/create-trial-button";
import { GenerateForm } from "@/components/create/generate-form";
import { QuotaGatedScreen } from "@/components/create/quota-gated-screen";
import { auth } from "@/lib/auth";
import { type Profile } from "@/lib/schema";
import {
  postService,
  profileService,
  subscriptionService,
} from "@/lib/services";

/**
 * `/create` — Create Posts (navigation redesign Wave 3 / task-09).
 *
 * The page is intentionally minimal: a title and ONE thing the user can
 * act on. Which "one thing" depends on their state:
 *
 *   - **Can generate** — render `<GenerateForm />` directly (theme +
 *     important-thing + length picker). The form's submit button reads
 *     "Create new posts" and is the only primary CTA on the page.
 *   - **Trial used** — render `<CreateTrialButton />`, a single "Create
 *     new posts" button that opens a click-time `<TrialUpgradeDialog />`
 *     instead of triggering generation. Replaces the previous full-page
 *     `<TrialGatedScreen />` (which also carried a "Review the batch you
 *     made" link that the redesign explicitly removed).
 *   - **Pro / Starter at cap, overage, inactive plan** — `<QuotaGatedScreen />`
 *     continues to handle these as a focal card. A future iteration can
 *     replace them with click-time Dialogs to match the trial behavior;
 *     out of scope for Wave 3 per the user's redesign brief.
 *
 * Stats (Posts Created · Posts Scheduled · Connected Accounts) live on
 * `/settings` (`<ActivityStatsSection />`), not here.
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

  // Trial-used branch (D20). Surface the upgrade Dialog on click rather
  // than a page-wall — the redesign treats trial-used users as first-class
  // visitors who see the same shell as everyone else.
  if (subscription.status === "trial") {
    const mostRecent = await postService.getMostRecentBatch(session.user.id);
    if (mostRecent) {
      return (
        <div className="max-w-3xl mx-auto space-y-12">
          <header>
            <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
              Create Posts
            </h1>
          </header>
          <div className="flex justify-center">
            <CreateTrialButton />
          </div>
        </div>
      );
    }
  }

  // Paid-user gate (Phase 3). The trial branch above handles the
  // cancelled-recoverable nuance that `<QuotaGatedScreen />` deliberately
  // doesn't replicate, so `canGenerate` only fires for non-trial users
  // here. The five-reason union maps 1:1 to the QuotaGatedScreen variants;
  // `trial_batch_exists` is unreachable in this position but kept in the
  // switch for exhaustiveness so a future `canGenerate` change can't
  // silently fall through.
  const gate = await subscriptionService.canGenerate(session.user.id);
  let belowSlot: React.ReactNode;
  if (!gate.allowed) {
    switch (gate.reason) {
      case "weekly_cap_active":
        belowSlot = (
          <QuotaGatedScreen variant="quota" nextResetAt={gate.nextResetAt} />
        );
        break;
      case "monthly_cap_active":
        // Temporary: reuses the weekly_cap_active "quota" variant so the
        // wave compiles. Task 13 (Wave 4) introduces a dedicated
        // `variant="monthly_quota"` with the 4-of-4-batches copy + the
        // `batchesUsed` field; swap this arm there.
        belowSlot = (
          <QuotaGatedScreen variant="quota" nextResetAt={gate.nextResetAt} />
        );
        break;
      case "starter_platforms_overage":
        belowSlot = (
          <QuotaGatedScreen
            variant="overage"
            currentCount={gate.currentCount}
          />
        );
        break;
      case "plan_inactive":
        belowSlot = <QuotaGatedScreen variant="inactive" />;
        break;
      case "trial_batch_exists":
        // Unreachable — the trial branch above already returned.
        break;
    }
  } else {
    const profile = await profileService.getProfile(session.user.id);
    const themePlaceholder = computeThemePlaceholder(profile);
    const importantThingPlaceholder =
      computeImportantThingPlaceholder(profile);
    belowSlot = (
      <GenerateForm
        themePlaceholder={themePlaceholder}
        importantThingPlaceholder={importantThingPlaceholder}
        hasProFeatures={subscriptionService.hasProFeatures(subscription)}
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <header>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Create Posts
        </h1>
      </header>
      {belowSlot}
    </div>
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
