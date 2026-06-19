import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  dayWindowOrFallback,
  postingDaysOrFallback,
} from "@/lib/scheduling/batch-calendar";
import { ordinalToDate } from "@/lib/scheduling/ordinal-to-date";
import type {
  Post,
  PostSelection,
  PostVariation,
  WeeklyBatch,
} from "@/lib/schema";
import { BatchPostListRow } from "./batch-post-list-row";
import { CancelBatchTrigger } from "./cancel-batch-trigger";
import { NetworkDayGrid } from "./network-day-grid";

/**
 * `<BatchDetailView />` — server-rendered orchestrator for `/schedule/[batchId]`.
 *
 * Receives the raw `weekly_batches` / `posts` / `post_selections` rows from
 * the route's page component and shapes them into the two derived views the
 * page renders:
 *
 *   1. **`GridColumn[]`** for the Network × Day matrix at the top
 *      (`<NetworkDayGrid />`). One column per ordinal `1..batch.totalPosts`
 *      with a per-platform ✓/✗ cell.
 *   2. **`Section[]`** for the per-network lists below the grid. One section
 *      per platform in fixed order Facebook → Instagram → LinkedIn, each with
 *      one row per selected `(postId, platform)` pair, ordered by `postOrder`
 *      ASC. The per-network section IS the truth about what was set to
 *      publish to that network.
 *
 * Reader source — PRESENT-DAY vs FUTURE-STATE (option (b), spec §5.3 amendment).
 *
 * Wave 5 originally shipped a `scheduled_posts`-backed reader per §6.9 /
 * D-S2-15. Post-land discovery: no writer populates `scheduled_posts` today
 * (Phase-4 cron deferred per spec §8) → every cell rendered ✗ and every
 * section read "No posts scheduled to {Network} yet." for every batch — the
 * same root cause as the Wave 4.5.1 0-count regression on `/schedule`, one
 * layer deeper.
 *
 * Resolution (locked-in option (b)): adopt the §5.3 PRESENT-DAY vs
 * FUTURE-STATE pattern already used by `getScheduledViewForUser`. Cells +
 * sections read `post_selections` today (row presence = selected per D14);
 * `canCancel` / `canRestore` are always `false` until the writer + cancel UI
 * both ship. Per-row scheduled time is the same fallback the column header
 * uses (`batch.createdAt + (postOrder - 1) days`) — there are no per-network
 * minute offsets today (fiction without a writer).
 *
 * Swap trigger: when BOTH (a) a `scheduled_posts` writer ships (Phase-4 cron
 * or an explicit step inside `scheduleBatch`) AND (b) the cancel UI is
 * required to surface real status, swap the reader back to `scheduled_posts`
 * filtered to `status IN ('pending', 'posted')` and re-introduce the D-S2-7 /
 * D-S2-21 gate computation. Same rule §5.3 documents for the `/schedule`
 * reader. See `specs/scheduled-and-create-redesign-stage-2/tasks/task-15-batch-detail-page.md`
 * for the addendum with the full locked-in intent and the authoritative
 * prompt path.
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
  | { kind: "scheduled" } // ✓ — post_selections row exists for (postId, platform) today; future: scheduled_posts row in status IN ('pending','posted')
  | { kind: "absent" }; //   ✗ — no selection row today; future: no row OR 'cancelled'

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
  // PRESENT-DAY reader (option (b), §5.3). See top-of-file docblock for the
  // FUTURE-STATE swap criteria.
  selectionRows: PostSelection[];
  // Per-network adapted text for Instagram / LinkedIn — the canonical Facebook
  // caption lives on `posts.postText`. Used to pick the right copy for each
  // per-network section row (schema.ts:232-266; mirrors the wizard's reader at
  // post-service.ts:606-630). Falls back to `posts.postText` when a variation
  // row is missing (e.g. Starter users, who don't get variations per Phase 3).
  variationRows: PostVariation[];
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
  selectionRows,
  variationRows,
}: Props): { columns: GridColumn[]; sections: Section[] } {
  // Index posts by postOrder for O(1) ordinal lookup. A given ordinal MAY have
  // no `posts` row (rare — e.g. the row was hard-deleted out of band); the
  // column still renders, just with all cells absent and a calendar fallback
  // day label.
  const postsByOrder = new Map<number, Post>();
  for (const p of postRows) postsByOrder.set(p.postOrder, p);

  // PRESENT-DAY reader (option (b), §5.3). Build a `(postId, platform)` key
  // set from `post_selections` for O(1) cell lookup. Row presence = selected
  // per D14 — no status filter (the table has no `status` column).
  const selectionKey = (postId: string, platform: string) =>
    `${postId}:${platform}`;
  const selectionsSet = new Set<string>();
  // Also index per-platform for section building.
  const selectionsByPlatform = new Map<Platform, Set<string>>();
  for (const platform of PLATFORMS) {
    selectionsByPlatform.set(platform, new Set<string>());
  }
  for (const r of selectionRows) {
    selectionsSet.add(selectionKey(r.postId, r.platform));
    if (
      r.platform === "facebook" ||
      r.platform === "instagram" ||
      r.platform === "linkedin"
    ) {
      selectionsByPlatform.get(r.platform)?.add(r.postId);
    }
  }

  // Per-ordinal fallback Date — the SAME formula used as the column header
  // day label today (and as the per-row scheduled time in the per-network
  // sections). There are no per-network minute offsets in present-day data —
  // those would be fiction without a `scheduled_posts` writer. When the
  // future swap lands and real scheduled times exist, the column header
  // reverts to `MIN(scheduledTime)` and per-row times use this
  // `(postId, platform)`'s real `scheduledTime`.
  //
  // Onboarding-posting-preferences (Wave 2): the ordinal→date mapping is no
  // longer linear when `working_days_only` / `weekends_only` filters skip
  // calendar days. `ordinalToDate` re-derives the filtered `dayOffsets` list
  // via `resolveBatchPlan`. Legacy batches (NULL `dayWindow`, NULL
  // `postingDays`) collapse to `every_day` semantics via the `*OrFallback`
  // helpers, preserving the pre-feature behaviour.
  const dayWindow = dayWindowOrFallback(batch);
  const postingDays = postingDaysOrFallback(batch);
  const ordinalDate = (order: number): Date =>
    ordinalToDate(batch.createdAt, order, dayWindow, postingDays);

  // ---------------------------------------------------------------------------
  // 1. Columns — one per filtered slot `1..batch.totalPosts`. After Wave 2.3
  // `batch.totalPosts` equals `dayOffsets.length` by construction.
  // ---------------------------------------------------------------------------
  const columns: GridColumn[] = [];
  for (let order = 1; order <= batch.totalPosts; order++) {
    const post = postsByOrder.get(order);
    const postId = post?.id ?? null;

    // PRESENT-DAY cell rule: scheduled iff a `post_selections` row exists for
    // (postId, platform). FUTURE-STATE: scheduled iff `scheduled_posts` row
    // exists in status IN ('pending', 'posted'). See top-of-file docblock.
    const cells = {
      facebook: { kind: "absent" } as GridCell,
      instagram: { kind: "absent" } as GridCell,
      linkedin: { kind: "absent" } as GridCell,
    };
    if (postId) {
      for (const platform of PLATFORMS) {
        if (selectionsSet.has(selectionKey(postId, platform))) {
          cells[platform] = { kind: "scheduled" };
        }
      }
    }

    columns.push({
      postOrder: order,
      postId,
      dayLabel: formatDayLabel(ordinalDate(order)),
      cells,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Sections — one per platform. Today: iterate posts in `postOrder` ASC
  // and include each whose `(postId, platform)` is in the selection set.
  // ---------------------------------------------------------------------------
  // Pre-compute cancel/restore gates as `false` for every row today.
  //
  // Rationale: the gates (D-S2-7 / D-S2-21) act on real `scheduled_posts`
  // rows — they require knowing per-platform status + `scheduledTime > now()`.
  // The PRESENT-DAY data layer has no `scheduled_posts` writer, so per-post
  // cancel/restore can't act on real rows; the dialogs would call into
  // `postService.cancelPost` / `restorePost` against a table that's empty for
  // this batch and the server would reject. Hiding the buttons keeps the UI
  // honest.
  //
  // When BOTH the writer AND the cancel UI ship, swap the reader back to
  // `scheduled_posts` and re-introduce the D-S2-7 / D-S2-21 gate computation
  // (the previous shape of these lines, preserved in git history at the
  // pre-option-(b) commit, is the reference). The `canCancel` / `canRestore`
  // fields stay on `SectionRow` precisely so this future swap is a one-line
  // flip rather than a re-add of the fields.
  const FUTURE_CAN_CANCEL = false;
  const FUTURE_CAN_RESTORE = false;

  // Per-network adapted-text lookup keyed by `${postId}:${platform}`. Only
  // Instagram + LinkedIn variations exist in `post_variations` (Facebook
  // canonical lives on `posts.postText`; schema enforces UNIQUE (postId,
  // platform) so the lookup is unambiguous). Missing entries fall through to
  // the canonical FB text per the Starter-user case and any other missing-row
  // edge case.
  const variationText = new Map<string, string>();
  for (const v of variationRows) {
    variationText.set(`${v.postId}:${v.platform}`, v.postText);
  }
  const textForPlatform = (post: Post, platform: Platform): string => {
    if (platform === "facebook") return post.postText;
    return variationText.get(`${post.id}:${platform}`) ?? post.postText;
  };

  const sections: Section[] = PLATFORMS.map((platform) => {
    const selectedPostIds = selectionsByPlatform.get(platform) ?? new Set();
    const platformRows: SectionRow[] = [];
    // Iterate posts in `postOrder` ASC (already sorted at the query layer).
    for (const post of postRows) {
      if (!selectedPostIds.has(post.id)) continue;
      platformRows.push({
        postOrder: post.postOrder,
        postId: post.id,
        postText: textForPlatform(post, platform),
        // Per-row time = the same fallback the column header uses today. No
        // per-network minute offsets without a writer.
        scheduledTime: ordinalDate(post.postOrder),
        // Cancelled rows literally can't exist today (no `scheduled_posts`
        // writes). Status is always "pending" until the future swap lands.
        status: "pending",
        canCancel: FUTURE_CAN_CANCEL,
        canRestore: FUTURE_CAN_RESTORE,
      });
    }
    return { platform, rows: platformRows };
  });

  return { columns, sections };
}

// =============================================================================
// Layout
// =============================================================================

export function BatchDetailView(props: Props) {
  // `now` is kept on `Props` (and still passed by the page) so the future swap
  // back to `scheduled_posts` can re-introduce the `scheduledTime > now()` gate
  // computation without re-plumbing the prop. Unused in the PRESENT-DAY shaper.
  const { batch, postRows } = props;
  const { columns, sections } = shape(props);
  const totalPosts = postRows.length;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-3">
        <Link
          href="/posting-soon"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Back to Posting Soon
        </Link>
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          {batch.batchOrdinalInPeriod !== null
            ? `Batch ${batch.batchOrdinalInPeriod}/4 · Upcoming`
            : "Batch · Upcoming"}
        </p>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium select-text cursor-text">
          {batch.theme}
        </h1>
        {batch.importantThing && (
          <p className="text-base text-muted-foreground leading-7 select-text cursor-text">
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
