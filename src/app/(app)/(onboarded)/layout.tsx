import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardMobileNav } from "@/components/dashboard/mobile-nav";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DashboardTopBar } from "@/components/dashboard/top-bar";
import { MonthlyCleanupGate } from "@/components/library/monthly-cleanup-gate";
import { auth } from "@/lib/auth";
import {
  postService,
  profileService,
  subscriptionService,
} from "@/lib/services";

/**
 * Layout for the post-onboarding section of the app. Wraps `/dashboard`,
 * `/posts`, `/library`, `/schedule`, `/settings`, `/create`.
 *
 * The cookie-based middleware gate (see `src/middleware.ts`) is the primary
 * line of defense, but this server-side check is the second one: it
 * re-resolves the session and the profile against the DB, so a stale or
 * tampered cookie cannot smuggle an unfinished user into the dashboard.
 *
 * The wrapper `min-h-[calc(100vh-4rem)]` matches the height the global
 * SiteHeader occupies (`py-3 sm:py-4` on a `text-xl sm:text-2xl` logo) so the
 * dashboard shell fills the remaining viewport without overlap.
 */
export default async function OnboardedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  // Defense-in-depth: middleware should already have caught this, but the
  // layout re-checks against the DB rather than trusting the cookie. The
  // cost is one cheap `select id` per page render.
  //
  // We redirect through the cookie-sync route rather than straight to
  // `/onboarding` because reaching this layout means the proxy thought the
  // user had a profile (the cookie said `1`). If the DB disagrees, the
  // cookie is stale and a naive `redirect("/onboarding")` would loop the
  // proxy back to `/dashboard`. The sync route clears the cookie first.
  const hasProfile = await profileService.hasProfile(session.user.id);
  if (!hasProfile) {
    redirect("/api/internal/sync-profile?to=/onboarding");
  }

  const subscription = await subscriptionService.checkSubscription(
    session.user.id,
  );

  // Trial-only `hasAnyBatch` lookup feeds `<DashboardTopBar />`'s pill
  // (Scheduled redesign D-S12). Paid plans use rolling-window counters from
  // the snapshot, so the DB hit is gated behind `plan === "free_trial"` to
  // keep the layout render path free for Starter/Pro. Cheap indexed `select
  // id limit 1` when it does fire.
  const hasAnyBatch =
    subscription.plan === "free_trial"
      ? await postService.hasAnyBatch(session.user.id)
      : false;

  // Pro-only `proBatchesUsed` count feeds `<DashboardTopBar />`'s pill
  // (Stage-2 D-S2-10 revised). The pill MUST match the server cap exactly so
  // a user can never see "N batches left" while `canGenerate` blocks them.
  // The server cap (subscription-service.ts D-A16) counts ALL batches in the
  // current Pro period regardless of status — cancelled, reviewing,
  // scheduling, completed all consume a slot. The snapshot already exposes
  // that exact number on `subscription.proQuota.used`, so the pill reads
  // straight from it. No `getScheduledViewForUser` hit needed here — the
  // grid-bound rolling-4 count and the period quota count are now two
  // different things; the pill cares only about the latter.
  const proBatchesUsed =
    subscription.plan === "pro" && subscription.proQuota !== null
      ? subscription.proQuota.used
      : 0;

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col">
        <DashboardMobileNav />
        <DashboardTopBar
          subscription={subscription}
          hasAnyBatch={hasAnyBatch}
          proBatchesUsed={proBatchesUsed}
        />
        <div className="flex-1 px-5 sm:px-8 lg:px-12 py-8 sm:py-12">
          {children}
        </div>
      </div>
      {/* Wave 3 Stage 4: first-of-month image library cleanup gate. Fires
          AT MOST ONCE per session (sessionStorage flag), renders nothing
          when no action is needed, or surfaces the reminder modal / runs
          silent cleanup as appropriate. */}
      <MonthlyCleanupGate />
    </div>
  );
}
