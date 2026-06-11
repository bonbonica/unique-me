import { headers } from "next/headers";
import { PlanSection } from "@/components/settings/plan-section";
import { PostingDaysSection } from "@/components/settings/posting-days-section";
import { auth } from "@/lib/auth";
import { postingDaysOrFallback } from "@/lib/scheduling/batch-calendar";
import { profileService, subscriptionService } from "@/lib/services";

/**
 * Phase 3 task-13: the Plan section is the first real card on this page.
 * Profile, connected-accounts, and notification sections arrive in later
 * phases. The (onboarded) layout already redirects unauthenticated
 * visitors; the page still re-resolves the session and guards on `null` to
 * satisfy the type narrower without a non-null assertion (same pattern as
 * `<DashboardPage />`).
 *
 * The starter-overage signal is derived here rather than inside the
 * service: `subscriptionService.canGenerate` produces a typed reason for
 * the gate path, but this card is informational only and doesn't need to
 * call the full gate — a Starter plan + > 2 platforms is the same
 * condition the gate checks (D6).
 */
export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return null;
  }

  const [subscription, profile] = await Promise.all([
    subscriptionService.checkSubscription(session.user.id),
    profileService.getProfile(session.user.id),
  ]);

  const platformOverage =
    subscription.plan === "starter" &&
    profile !== null &&
    profile.platforms.length > 2
      ? { count: profile.platforms.length }
      : null;

  return (
    <div className="max-w-2xl space-y-12">
      <header className="space-y-4">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Settings
        </h1>
        <p className="text-lg text-muted-foreground leading-8">
          Profile, connected accounts, subscription, and notifications.
        </p>
      </header>

      <PlanSection
        plan={subscription.plan}
        status={subscription.status}
        daysLeftInTrial={subscription.daysLeftInTrial}
        nextResetAt={subscription.nextResetAt}
        platformOverage={platformOverage}
        proQuota={subscription.proQuota}
      />

      {profile !== null ? (
        // The (onboarded) layout guarantees `profile` is non-null in practice;
        // the explicit guard satisfies the narrower without an assertion and
        // matches the same defensive pattern used for `session` above.
        // `postingDaysOrFallback` collapses a legacy NULL row into the
        // every-day default the spec dictates.
        <PostingDaysSection
          initial={postingDaysOrFallback({
            postingDays: profile.postingDays ?? null,
          })}
          plan={subscription.plan}
        />
      ) : null}
    </div>
  );
}
