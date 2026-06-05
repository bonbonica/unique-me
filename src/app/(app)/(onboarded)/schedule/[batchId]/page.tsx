import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { BatchDetailView } from "@/components/schedule/batch-detail-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { posts, scheduledPosts, weeklyBatches } from "@/lib/schema";

/**
 * Dynamic route `/schedule/[batchId]` — Stage-2 D-S2-15.
 *
 * Server component. Owns auth + ownership enforcement + raw data fetch; hands
 * the rows off to `<BatchDetailView />` which shapes them into the network ×
 * day grid + per-network sections.
 *
 * Ownership is enforced at the `weekly_batches` lookup (`AND userId = ?`).
 * A foreign or unknown batchId falls through to `notFound()` (Next renders the
 * 404 boundary). The downstream `posts` / `scheduled_posts` reads inherit the
 * ownership guarantee from the batch lookup — they don't re-check userId
 * because the batch FK already constrains the data to the owning user.
 *
 * Reads live data so the page lights up automatically when the Phase-4 cron
 * writer lands. Until then, batches have no `scheduled_posts` rows in
 * production — the grid renders all-✗ and the per-network sections render
 * their neutral "No posts scheduled to {Network} yet." empty state.
 */
export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { batchId } = await params;

  const [batch] = await db
    .select()
    .from(weeklyBatches)
    .where(
      and(
        eq(weeklyBatches.id, batchId),
        eq(weeklyBatches.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!batch) notFound();

  const postRows = await db
    .select()
    .from(posts)
    .where(eq(posts.batchId, batchId))
    .orderBy(asc(posts.postOrder));

  const postIds = postRows.map((p) => p.id);
  const scheduledRows = postIds.length
    ? await db
        .select()
        .from(scheduledPosts)
        .where(inArray(scheduledPosts.postId, postIds))
    : [];

  return (
    <BatchDetailView
      batch={batch}
      postRows={postRows}
      scheduledRows={scheduledRows}
      now={new Date()}
    />
  );
}
