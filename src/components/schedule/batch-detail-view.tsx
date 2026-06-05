import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Post, ScheduledPost, WeeklyBatch } from "@/lib/schema";
import { BatchPostListRow } from "./batch-post-list-row";
import { CancelBatchTrigger } from "./cancel-batch-trigger";
import { NetworkDayGrid } from "./network-day-grid";

/**
 * `<BatchDetailView />` — server-rendered orchestrator for `/schedule/[batchId]`.
 *
 * Receives the raw `weekly_batches` / `posts` / `scheduled_posts` rows from
 * the route's page component and shapes them into the two derived views the
 * page renders:
 *
 *   1. **`GridColumn[]`** for the Network × Day matrix at the top
 *      (`<NetworkDayGrid />`). One column per ordinal `1..batch.totalPosts`
 *      with a per-platform ✓/✗ cell.
 *   2. **`Section[]`** for the per-network lists below the grid. One section
 *      per platform in fixed order Facebook → Instagram → LinkedIn, each with
 *      one row per `scheduled_posts` entry for that platform (every status —
 *      `pending`, `posted`, `cancelled` — surfaces here; the per-network
 *      section IS the truth about what was set to publish to that network).
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content): `max-w-3xl`,
 * `space-y-8`. Sections are `<article id="network-{platform}">` anchors that
 * the grid rows link into; `scroll-mt-24` gives a comfortable offset below
 * any fixed header so the anchor jump lands cleanly. Smooth scroll lives at
 * the document level (DESIGN.md §11 global `scroll-behavior` rule, which is
 * automatically disabled by `prefers-reduced-motion: reduce` globally).
 */

// =============================================================================
// Types — shared with the grid + row child components.
// =============================================================================

export const PLATFORMS = ["facebook", "instagram", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export type GridCell =
  | { kind: "scheduled" } // ✓ — scheduled_posts row in status IN ('pending','posted')
  | { kind: "absent" }; //   ✗ — no row, OR row is 'cancelled' (treated as absent)

export type GridColumn = {
  postOrder: number;
  postId: string | null; // null when no `posts` row exists for this ordinal
  dayLabel: string; // formatted "DOW Mon DD"
  cells: Record<Platform, GridCell>;
};

export type SectionRow = {
  postOrder: number;
  postId: string;
  postText: string;
  scheduledTime: Date; // THIS (postId, platform) row's value
  status: "pending" | "posted" | "cancelled" | "failed";
  canCancel: boolean; // D-S2-7 gate, pre-computed server-side
  canRestore: boolean; // D-S2-21 gate, pre-computed server-side
};

export type Section = {
  platform: Platform;
  rows: SectionRow[];
};

type Props = {
  batch: WeeklyBatch;
  postRows: Post[];
  scheduledRows: ScheduledPost[];
  now: Date;
};

// =============================================================================
// Data shaping helpers
// =============================================================================

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Mon Jun 03" — short DOW + short month + zero-padded day. */
function formatDayLabel(d: Date): string {
  const dow = DOW[d.getDay()];
  const mon = MONTH[d.getMonth()];
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dow} ${mon} ${dd}`;
}

function shape({
  batch,
  postRows,
  scheduledRows,
  now,
}: Props): { columns: GridColumn[]; sections: Section[] } {
  // Index posts by postOrder for O(1) ordinal lookup. A given ordinal MAY have
  // no `posts` row (rare — e.g. the row was hard-deleted out of band); the
  // column still renders, just with all cells absent and a calendar fallback
  // day label.
  const postsByOrder = new Map<number, Post>();
  for (const p of postRows) postsByOrder.set(p.postOrder, p);

  // Index scheduled_posts by postId, keeping every row (every status). The
  // column-cell filter and the per-section row builder both consume this map,
  // each applying its own status filter.
  const scheduledByPostId = new Map<string, ScheduledPost[]>();
  for (const r of scheduledRows) {
    const bucket = scheduledByPostId.get(r.postId) ?? [];
    bucket.push(r);
    scheduledByPostId.set(r.postId, bucket);
  }

  const nowMs = now.getTime();
  const batchCreatedMs = batch.createdAt.getTime();
  const DAY_MS = 86_400_000;

  // ---------------------------------------------------------------------------
  // 1. Columns — one per ordinal `1..batch.totalPosts`.
  // ---------------------------------------------------------------------------
  const columns: GridColumn[] = [];
  for (let order = 1; order <= batch.totalPosts; order++) {
    const post = postsByOrder.get(order);
    const postId = post?.id ?? null;
    const rowsForPost = postId ? (scheduledByPostId.get(postId) ?? []) : [];

    // Cell rule per D-S2-15: scheduled iff a row exists for (postId, platform)
    // with status IN ('pending', 'posted'). `cancelled` and missing both → absent.
    const cells = {
      facebook: { kind: "absent" } as GridCell,
      instagram: { kind: "absent" } as GridCell,
      linkedin: { kind: "absent" } as GridCell,
    };
    for (const r of rowsForPost) {
      if (r.status !== "pending" && r.status !== "posted") continue;
      if (
        r.platform === "facebook" ||
        r.platform === "instagram" ||
        r.platform === "linkedin"
      ) {
        cells[r.platform] = { kind: "scheduled" };
      }
    }

    // Day label = MIN(scheduledTime) over non-cancelled rows. Fallback to
    // batch.createdAt + (order - 1) days when no such row exists — the
    // present-day reality before the Phase-4 cron writer ships.
    let labelDate: Date;
    const nonCancelledTimes = rowsForPost
      .filter((r) => r.status !== "cancelled")
      .map((r) => r.scheduledTime.getTime());
    if (nonCancelledTimes.length > 0) {
      labelDate = new Date(Math.min(...nonCancelledTimes));
    } else {
      labelDate = new Date(batchCreatedMs + (order - 1) * DAY_MS);
    }

    columns.push({
      postOrder: order,
      postId,
      dayLabel: formatDayLabel(labelDate),
      cells,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Sections — one per platform, every status surfaces.
  // ---------------------------------------------------------------------------
  const sections: Section[] = PLATFORMS.map((platform) => {
    const platformRows = scheduledRows
      .filter((r) => r.platform === platform)
      .map((r) => {
        const post = postRows.find((p) => p.id === r.postId);
        // `post` is guaranteed present here — scheduled_posts.postId has a
        // cascade FK to posts.id, and `postRows` covers every post in the
        // batch. The defensive guard below keeps the type system honest.
        if (!post) return null;

        const allForPost = scheduledByPostId.get(post.id) ?? [];
        const anyPosted = allForPost.some((x) => x.status === "posted");
        const anyFuturePending = allForPost.some(
          (x) =>
            x.status === "pending" && x.scheduledTime.getTime() > nowMs,
        );
        const anyFutureCancelled = allForPost.some(
          (x) =>
            x.status === "cancelled" && x.scheduledTime.getTime() > nowMs,
        );

        // D-S2-7 cancel gate — re-applied as UI affordance (server re-checks
        // inside postService.cancelPost; this is hide-only, not a security
        // boundary).
        const canCancel =
          r.status !== "cancelled" && anyFuturePending && !anyPosted;

        // D-S2-21 restore gate — symmetric.
        const canRestore =
          r.status === "cancelled" && anyFutureCancelled && !anyPosted;

        const row: SectionRow = {
          postOrder: post.postOrder,
          postId: post.id,
          postText: post.postText,
          // Per-network offset surfaces here: this is THIS (postId, platform)
          // row's scheduledTime, NOT the cross-network MIN used for the
          // column header.
          scheduledTime: r.scheduledTime,
          status: r.status as SectionRow["status"],
          canCancel,
          canRestore,
        };
        return row;
      })
      .filter((r): r is SectionRow => r !== null)
      .sort((a, b) => a.postOrder - b.postOrder);

    return { platform, rows: platformRows };
  });

  return { columns, sections };
}

// =============================================================================
// Layout
// =============================================================================

export function BatchDetailView({ batch, postRows, scheduledRows, now }: Props) {
  const { columns, sections } = shape({ batch, postRows, scheduledRows, now });
  const totalPosts = postRows.length;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-3">
        <Link
          href="/schedule"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Back to Scheduled
        </Link>
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          {batch.batchOrdinalInPeriod !== null
            ? `Batch ${batch.batchOrdinalInPeriod} · Upcoming`
            : "Batch · Upcoming"}
        </p>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {batch.theme}
        </h1>
        {batch.importantThing && (
          <p className="text-base text-muted-foreground leading-7">
            {batch.importantThing}
          </p>
        )}
      </header>

      <NetworkDayGrid columns={columns} />

      <section className="space-y-12" aria-label="Posts by network">
        {sections.map((section) => (
          <article
            key={section.platform}
            id={`network-${section.platform}`}
            className="space-y-4 scroll-mt-24"
          >
            <h2 className="font-fraunces text-2xl tracking-tight font-medium">
              {PLATFORM_LABEL[section.platform]}
            </h2>
            {section.rows.length === 0 ? (
              <p className="text-base text-muted-foreground leading-7">
                No posts scheduled to {PLATFORM_LABEL[section.platform]} yet.
              </p>
            ) : (
              section.rows.map((row) => (
                <BatchPostListRow
                  key={`${row.postId}-${section.platform}`}
                  row={row}
                  batchId={batch.id}
                />
              ))
            )}
          </article>
        ))}
      </section>

      <footer className="pt-8 border-t border-border">
        <CancelBatchTrigger batchId={batch.id} totalPosts={totalPosts} />
      </footer>
    </div>
  );
}
