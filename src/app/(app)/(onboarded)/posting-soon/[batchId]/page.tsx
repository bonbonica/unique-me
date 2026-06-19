import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { BatchDetailView } from "@/components/schedule/batch-detail-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  posts,
  postSelections,
  postVariations,
  weeklyBatches,
} from "@/lib/schema";

/**
 * Dynamic route `/schedule/[batchId]` — Stage-2 D-S2-15.
 *
 * Server component. Owns auth + ownership enforcement + raw data fetch; hands
 * the rows off to `<BatchDetailView />` which shapes them into the network ×
 * day grid + per-network sections.
 *
 * Ownership is enforced at the `weekly_batches` lookup (`AND userId = ?`).
 * A foreign or unknown batchId falls through to `notFound()` (Next renders the
 * 404 boundary). The downstream `posts` / `post_selections` reads inherit the
 * ownership guarantee from the batch lookup — they don't re-check userId
 * because the batch FK already constrains the data to the owning user.
 *
 * Reader source — PRESENT-DAY (option (b), per spec §5.3 PRESENT-DAY vs
 * FUTURE-STATE). The page reads `post_selections` rather than
 * `scheduled_posts` because no writer populates `scheduled_posts` today
 * (Phase-4 cron deferred per spec §8). Row presence in `post_selections`
 * answers "is this (postId, platform) scheduled?" — the same source `/create`
 * and the `/schedule` boxes already use via `loadSelectionCounts`. When BOTH
 * (a) a `scheduled_posts` writer ships and (b) the cancel UI is required, the
 * reader swaps back — see the task-15 addendum and `<BatchDetailView />`
 * docblock for the locked-in swap criteria.
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

  // PRESENT-DAY reader (option (b)): `post_selections` rows answer "is this
  // (postId, platform) scheduled?" today. No status filter — the table has
  // no `status` column; row presence = selected. See docblock above.
  //
  // `post_variations` carries the per-network adapted text for Instagram /
  // LinkedIn (the canonical Facebook caption lives on `posts.postText`). The
  // detail page needs all three so each per-network section renders its real
  // copy rather than the FB canonical for every row — mirrors the wizard's
  // `getBatchForReview` fetch shape (post-service.ts:575-648).
  const postIds = postRows.map((p) => p.id);
  const [selectionRows, variationRows] = postIds.length
    ? await Promise.all([
        db
          .select()
          .from(postSelections)
          .where(inArray(postSelections.postId, postIds)),
        db
          .select()
          .from(postVariations)
          .where(inArray(postVariations.postId, postIds)),
      ])
    : [[], []];

  return (
    <BatchDetailView
      batch={batch}
      postRows={postRows}
      selectionRows={selectionRows}
      variationRows={variationRows}
      now={new Date()}
    />
  );
}
