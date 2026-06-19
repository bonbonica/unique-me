import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LockedSummary } from "@/components/posts/locked-summary";
import { NetworkWizard } from "@/components/posts/network-wizard";
import { auth } from "@/lib/auth";
import { postService, subscriptionService } from "@/lib/services";

/**
 * `/schedule-posts/[batchId]` review page. Lifts the branching logic from
 * the legacy `/posts` route (which still resolves until task-05 deletes
 * it) onto a path-based dynamic segment. Same status switch, same
 * components, same defensive redirects — only the way `batchId` is
 * resolved changes (path param instead of search param).
 *
 * Status branches:
 *  - `reviewing` → {@link NetworkWizard} (editable; per-network wizard).
 *  - `cancelled` → {@link NetworkWizard mode="cancelled"} (cancelled-
 *    recoverable flow; user can re-edit + re-schedule within trial window).
 *  - `scheduling` → {@link LockedSummary} (read-only; stop-batch action).
 *  - `scheduled` / `completed` → bounce to `/dashboard` (Wave 3 task-08
 *    deletes `/dashboard` and switches root to `/create`; until then the
 *    legacy target stays so behaviour matches the old `/posts` route).
 *  - `in_progress` / unknown → bounce to `/create` (stale state).
 */
type Params = Promise<{ batchId: string }>;

export default async function SchedulePostsDetailPage({
  params,
}: {
  params: Params;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { batchId } = await params;

  const data = await postService.getBatchForReview(batchId, session.user.id);
  if (!data) {
    // Either the batch doesn't exist or it isn't owned by the session
    // user. Send to /create rather than reveal which case it was.
    redirect("/create");
  }

  // Defensive: empty platforms array means onboarding never wrote the
  // column. Send the user back to fix that before they can use the wizard.
  if (data.platforms.length === 0) {
    redirect("/onboarding");
  }

  // Pro-only regenerate gate (mirrors /posts/page.tsx). Active trial users
  // get Pro-equivalent feature access via hasProFeatures.
  const sub = await subscriptionService.checkSubscription(session.user.id);
  const isPro = subscriptionService.hasProFeatures(sub);

  switch (data.batch.status) {
    case "reviewing":
      return <NetworkWizard data={data} mode="reviewing" isPro={isPro} />;
    case "cancelled":
      return <NetworkWizard data={data} mode="cancelled" isPro={isPro} />;
    case "scheduling":
      return <LockedSummary data={data} />;
    case "scheduled":
    case "completed":
      return redirect("/dashboard");
    case "in_progress":
      return redirect("/create");
    default:
      return redirect("/create");
  }
}
