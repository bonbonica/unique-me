import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { auth } from "@/lib/auth";
import { profileService, subscriptionService } from "@/lib/services";

/**
 * Onboarding page (Phase 1, spec § 1.4).
 *
 * Server-side gate: the proxy already ensures the user has a session cookie
 * before reaching this route, but we still re-verify here for two reasons —
 * (1) the cookie is only a fast-path hint, (2) we need the actual `session.user`
 * to render the personalised greeting. If the user is already onboarded the
 * proxy will have redirected them to `/dashboard`; the second `hasProfile`
 * check is a defence-in-depth backstop for the case where the cookie was
 * cleared but the DB row still exists.
 *
 * This page deliberately lives at `src/app/(app)/onboarding/` — outside the
 * `(app)/(onboarded)/` sidebar shell owned by Wave 3B — so onboarding has a
 * full-bleed, focal layout without dashboard chrome.
 */

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  // If the DB says the user is already onboarded but the proxy let us in
  // anyway, the `uniqueme:has-profile` cookie is missing or stale. Route
  // through the cookie-sync handler so it gets set before we land on
  // `/dashboard` — otherwise the proxy will redirect us straight back here
  // and loop.
  const has = await profileService.hasProfile(session.user.id);
  if (has) {
    redirect("/api/internal/sync-profile?to=/dashboard");
  }

  // Phase 3 D6 (task-14): the onboarding platform picker enforces a max of
  // 2 platforms for Starter users. In practice fresh signups are always on
  // `free_trial` at this point (the trial row is created by Better Auth's
  // user-create hook before we land here, and paid plans are only set via
  // the DB after onboarding has run). We still pull the snapshot for the
  // rare future "re-onboarding for an existing Starter" scenario so the
  // cap is correct without a second code path.
  const subscription = await subscriptionService.checkSubscription(
    session.user.id
  );

  // Pull the greeting name straight from the session. Better Auth guarantees
  // `name` is set on the user record (we wired it as `notNull()` in the
  // `user` table); fall back to "there" only as a paranoid default.
  const greetingName = session.user.name || "there";

  return (
    <div className="auth-bg min-h-[calc(100vh-4rem)] flex items-start justify-center px-5 sm:px-8 py-12 sm:py-16 lg:py-24">
      <div className="w-full max-w-2xl">
        <header>
          <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
            Welcome to <span className="gilt">UniqueMe</span>, {greetingName}.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground leading-8">
            Tell us about your business so your AI can create posts that sound
            like you. One minute, once. Edit anytime in Settings.
          </p>
        </header>
        <OnboardingForm plan={subscription.plan} />
      </div>
    </div>
  );
}
