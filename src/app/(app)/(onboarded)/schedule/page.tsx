import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScheduledPageClient } from "@/components/schedule/scheduled-page-client";
import { auth } from "@/lib/auth";
import { postService, subscriptionService } from "@/lib/services";

/**
 * Scheduled hub (Stage-1 redesign). Server component — owns auth + data
 * fetching. Renders the page header and hands the `ScheduledView` to a
 * client wrapper that manages the cancel-dialog state.
 *
 * Two parallel reads:
 *   - `getScheduledViewForUser` returns the rolling-4 grid data.
 *   - `checkSubscription` returns the period-cap snapshot whose
 *     `proQuota.used` count drives the `<CreateNextBatchCta />` label. That
 *     count is the same one `canGenerate` evaluates against the 4-per-period
 *     cap (D-A16) — cancelled batches are included, so the CTA can never
 *     promise a slot the server cap won't honour.
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content): `max-w-3xl`,
 * generous `space-y-12` between sections. The top quota pill + sidebar are
 * provided by the `(onboarded)` layout and are not duplicated here.
 */
export default async function SchedulePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [view, subscription] = await Promise.all([
    postService.getScheduledViewForUser(session.user.id),
    subscriptionService.checkSubscription(session.user.id),
  ]);

  // Pro plan: feed the true period count into the CTA. Trial / Starter
  // ignore the CTA's /4 semantic; default to 0 so the prop type stays plain
  // `number` and the CTA's `atCap` check (>= 4) never trips spuriously for
  // those plans.
  const proBatchesUsed =
    subscription.plan === "pro" && subscription.proQuota !== null
      ? subscription.proQuota.used
      : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <header>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Scheduled
        </h1>
      </header>

      <ScheduledPageClient view={view} proBatchesUsed={proBatchesUsed} />
    </div>
  );
}
