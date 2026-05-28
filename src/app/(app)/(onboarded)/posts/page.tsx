import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";
import { LockedSummary } from "@/components/posts/locked-summary";
import { NetworkWizard } from "@/components/posts/network-wizard";

/**
 * `/posts` review page (Phase 2 task-08). Server component that loads the
 * batch and branches by `weekly_batches.status`:
 *
 *  - `reviewing` → {@link NetworkWizard} (editable; per-network steps +
 *    summary; selections mutable; edit/regenerate available)
 *  - `scheduling`, `cancelled` → {@link LockedSummary} (read-only; the
 *    only action in `scheduling` is stop-batch)
 *  - `scheduled` / `completed` → Phase 4 owns the UI; for now redirect
 *    to `/dashboard` so the user isn't trapped on an unrendered status.
 *  - `in_progress` → stale/unreachable status; bounce to `/create`.
 *
 * Batch resolution: `?batchId=` query param wins. Without it, fall back
 * to {@link postService.getCurrentBatch} which returns the most recent
 * batch in `reviewing` or `scheduling` status — the post-Generate
 * redirect path.
 */
type SearchParams = Promise<{ batchId?: string }>;

export default async function PostsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { batchId: paramBatchId } = await searchParams;

  let batchId = paramBatchId;
  if (!batchId) {
    const current = await postService.getCurrentBatch(session.user.id);
    if (!current) {
      redirect("/create");
    }
    batchId = current.id;
  }

  const data = await postService.getBatchForReview(batchId, session.user.id);
  if (!data) {
    // Either the batch doesn't exist or it isn't owned by the session
    // user. Either way, the right answer is to send them to /create rather
    // than reveal which case it was.
    redirect("/create");
  }

  // Defensive: empty platforms array means onboarding never wrote the
  // column. Send the user back to fix that before they can use the wizard.
  if (data.platforms.length === 0) {
    redirect("/onboarding");
  }

  switch (data.batch.status) {
    case "reviewing":
      return <NetworkWizard data={data} />;
    case "scheduling":
    case "cancelled":
      return <LockedSummary data={data} />;
    case "scheduled":
    case "completed":
      // Phase 4 owns these UIs. For now bounce so the user doesn't see
      // an empty page. `redirect()` returns `never`, but we wrap it in a
      // `return` statement so TS's exhaustiveness analysis is happy without
      // needing to assume the function exits here.
      return redirect("/dashboard");
    case "in_progress":
      // Stale state — current code paths don't produce this. Defensive.
      return redirect("/create");
    default:
      // `data.batch.status` is inferred as `string` (Drizzle's text column
      // type), not the narrow BatchStatus union, so TS requires a default.
      // Any unknown status value is treated as broken state — restart from
      // /create.
      return redirect("/create");
  }
}
