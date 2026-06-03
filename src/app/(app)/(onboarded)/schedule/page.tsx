import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScheduledPageClient } from "@/components/schedule/scheduled-page-client";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

/**
 * Scheduled hub (Stage-1 redesign). Server component — owns auth + data
 * fetching. Renders the page header and hands the `ScheduledView` to a
 * client wrapper that manages the cancel-dialog state.
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content): `max-w-3xl`,
 * generous `space-y-12` between sections. The top quota pill + sidebar are
 * provided by the `(onboarded)` layout and are not duplicated here.
 */
export default async function SchedulePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const view = await postService.getScheduledViewForUser(session.user.id);

  return (
    <div className="max-w-3xl mx-auto space-y-12">
      <header>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Scheduled
        </h1>
      </header>

      <ScheduledPageClient view={view} />
    </div>
  );
}
