# Task 15: /schedule/[batchId] detail page

## Status
not started

## Wave
5

## Re-issue note

This task file was re-issued after the Stage-2 spec update introduced (a) the Network × Day grid (D-S2-15) replacing the per-day strip, and (b) the non-destructive Cancel-vs-Delete contract (§0, D-S2-6 / D-S2-7 / D-S2-21 / D-S2-22). The original draft built a column of `<PostDaySlot />` rows with a hardcoded `1..7` loop; the re-issued draft builds a network × day grid sized to the **real batch length** (Pro batch 4 = 9 posts) plus per-network grouped sections. The per-post cancel is no longer destructive — no image movement, restore is available, dialog button is non-destructive variant.

## Post-land amendment — option (b) selection-backed reader

Wave 5 originally shipped a `scheduled_posts`-backed reader per §6.9 / D-S2-15. Post-land discovery: no writer populates `scheduled_posts` today (Phase-4 cron deferred per §0 / §8), so every cell rendered ✗ and every per-network section read `"No posts scheduled to {Network} yet."` for every batch — same root cause as the Wave 4.5.1 0-count regression on `/schedule`, one layer deeper.

Resolved by adopting the §5.3 PRESENT-DAY vs FUTURE-STATE pattern (the same amendment already governs `getScheduledViewForUser`): cells + sections now read `post_selections` (row presence = selected per D14); `canCancel` / `canRestore` are always `false` until the writer + cancel UI both ship. Per-row scheduled time is the same fallback the column header uses (`batch.createdAt + (postOrder - 1) days`) — there are no per-network minute offsets in present-day data without a writer. The `canCancel` / `canRestore` fields stay on `SectionRow` so the future swap is structural, not additive.

**Swap trigger.** When BOTH (a) a `scheduled_posts` writer ships (Phase-4 cron or an explicit step inside `scheduleBatch`) AND (b) the cancel UI is required to surface real status, swap the reader back to `scheduled_posts` filtered to `status IN ('pending', 'posted')` and re-introduce the D-S2-7 / D-S2-21 gate computation. Same rule §5.3 documents for the `/schedule` reader.

**Files touched by the amendment.**
- `src/app/(app)/(onboarded)/schedule/[batchId]/page.tsx` — query `post_selections` instead of `scheduled_posts`; rename `scheduledRows` → `selectionRows`.
- `src/components/schedule/batch-detail-view.tsx` — `selectionRows: PostSelection[]` prop; rebuilt `shape()` reading row-presence in `post_selections`; gates pinned `false`; docblock spells out the PRESENT-DAY / FUTURE-STATE contract.
- This task file — addendum (this section).

`spec.md` is intentionally not edited; §5.3 already governs the pattern.

Authoritative prompt with the full locked-in intent: `C:\UniqueMe\prompts\scheduled-and-create-redesign-stage-2-wave-5-option-b-selections-reader.md`.

## Description

Build the new `/schedule/[batchId]` route (fixes today's 404 on the `{N} posts` link from `<ScheduledBatchBox />`). The page renders a **Network × Day grid** at the top — rows = networks (Facebook → Instagram → LinkedIn today, architected for new networks to append), columns = days of the batch (column count = `weeklyBatches.totalPosts`, NOT hardcoded). Each cell is a ✓ iff a `scheduled_posts` row exists for that `(postId, platform)` pair with `status IN ('pending', 'posted')`; otherwise ✗. `'cancelled'` rows render as ✗ (treated as absent per the Cancel-vs-Delete contract).

Below the grid, the page renders one **section per network** in the same fixed order — each section's container carries `id="network-{platform}"` and lists every post with a `scheduled_posts` row for that platform (any status), ordered by `postOrder` ASC. Each grid row (label + cells) is a clickable native `<a href="#network-{platform}">` anchor that jumps to that section — grouping, not filtering. Per-post `[Cancel]` calls the non-destructive whole-post `cancelPost(postId)` (D-S2-6) — no `platform` argument. Cancelled posts get `[Restore]` (D-S2-21). Footer `[Cancel batch]` reuses the Stage-1 dialog.

**Production reality at land time.** No writer populates `scheduled_posts` rows in production yet (Phase-4 cron is deferred per §0). For live batches, the grid will therefore render all-✗ and the per-network sections will be empty. The page must be coded to read live data so it lights up automatically when the cron writer lands — no further code change required. Empty-state copy must stay neutral so users don't read it as a bug.

## Dependencies

**Depends on:**
- task-04 — `postService.cancelPost(sessionUserId, postId, platform?)` per the re-issued non-destructive contract (D-S2-6 / D-S2-7). Whole-post scope (no `platform` argument) is the only UI surface in Stage-2.
- task-04 — `postService.restorePost(sessionUserId, postId, platform?)` per D-S2-21 (re-issued task-04 ships both).
- task-02 — shared ownership / status filter conventions. This task reads `weekly_batches` / `posts` / `scheduled_posts` directly; it does NOT call `getScheduledViewForUser`.

**Blocks:** none.
**Parallel with:** task-16.

## Files to Create

- `src/app/(app)/(onboarded)/schedule/[batchId]/page.tsx` — dynamic route, server component, fetches batch + posts + scheduled_posts, enforces ownership.
- `src/components/schedule/batch-detail-view.tsx` — server component orchestrator. Receives the shaped data from the page, renders header + theme + importantThing + `<NetworkDayGrid />` + per-network sections + footer.
- `src/components/schedule/network-day-grid.tsx` — the Network × Day matrix (D-S2-15). Renders one row per network with clickable native `<a href="#network-{platform}">` wrappers; one column per ordinal sized to `batch.totalPosts`; cell = ✓ iff a `scheduled_posts` row exists for `(postId, platform)` with `status IN ('pending', 'posted')`, else ✗.
- `src/components/schedule/batch-post-list-row.tsx` — one row primitive used inside each per-network section. Renders day label + per-(postId, platform) `scheduled_posts.scheduledTime` + post text + per-post `[Cancel]` (live row, D-S2-7 gate open) or `[Restore]` (cancelled row, D-S2-21 gate open).
- `src/components/schedule/cancel-post-dialog.tsx` — per-post cancel confirm dialog. Copy per §6.11 verbatim. **Button variant is `outline` (NOT `destructive`)** — cancel is reversible per the Cancel-vs-Delete contract.
- `src/components/schedule/restore-post-dialog.tsx` — per-post restore confirm dialog. Non-destructive copy; primary button variant `default` (champagne).
- `src/app/(app)/(onboarded)/schedule/[batchId]/actions.ts` — `cancelPostAction(postId, batchId)` and `restorePostAction(postId, batchId)` server actions.

## Files Retired (do not create)

- `src/components/schedule/post-day-slot.tsx` — the previous draft's per-ordinal row primitive. Retired entirely. Hardcoded `for (order = 1..7)` and was structured as a vertical column of day-slots; the network × day grid + per-network sections replace it cleanly per §6.9 / §6.10.

## Files to Modify

None. The Stage-1 `<CancelBatchDialog />` at `src/components/schedule/cancel-batch-dialog.tsx` is reused as-is. The Stage-1 `<CancelBatchTrigger />` pattern (or its inline equivalent) is reused for the footer.

## Implementation Steps

### 1. Server actions

```ts
// schedule/[batchId]/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

export async function cancelPostAction(
  postId: string,
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await postService.cancelPost(session.user.id, postId);
  if (!result.ok) return result;

  revalidatePath(`/schedule/${batchId}`);
  revalidatePath("/schedule");
  // NOTE: No revalidatePath('/library') — cancel is non-destructive and
  // does NOT move images to the Library per the Cancel-vs-Delete contract
  // (§0, D-S2-6). The future `deletePost` surface (D-S2-22 — not built
  // in Stage-2) is the per-post path that will feed the Library; when it
  // ships, its action will reinstate the `/library` revalidation.
  return { ok: true };
}

export async function restorePostAction(
  postId: string,
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await postService.restorePost(session.user.id, postId);
  if (!result.ok) return result;

  revalidatePath(`/schedule/${batchId}`);
  revalidatePath("/schedule");
  return { ok: true };
}
```

`postService.cancelPost` (re-issued task-04) returns the union `{ ok: true; batchId; cancelledCount } | { ok: false; error: 'already_posted' | 'not_found' | 'not_owned' }`. `postService.restorePost` returns `{ ok: true; batchId; restoredCount } | { ok: false; error: 'not_restorable' | 'not_found' | 'not_owned' }`. Mirror the error keys exactly.

### 2. Server page

```tsx
// schedule/[batchId]/page.tsx
import { and, asc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { posts, scheduledPosts, weeklyBatches } from "@/lib/schema";
import { BatchDetailView } from "@/components/schedule/batch-detail-view";

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
```

The shaping step (grid columns + per-network sections) happens in `<BatchDetailView />` (step 3). Keep ownership enforcement on the `weekly_batches` lookup at this layer; the section + grid builders run on already-owned data.

### 3. `<BatchDetailView />` (server) — data shaping

Derive the page shape from `batch.totalPosts` (equivalently `MAX(posts.postOrder)`), NOT a hardcoded `7`. Pro batch 4 is 9 posts.

```ts
const PLATFORMS = ["facebook", "instagram", "linkedin"] as const;
type Platform = (typeof PLATFORMS)[number];

type GridCell =
  | { kind: "scheduled" }   // ✓ — scheduled_posts row in status IN ('pending','posted')
  | { kind: "absent" };     // ✗ — no row, OR row is 'cancelled' (treated as absent)

type GridColumn = {
  postOrder: number;
  postId: string | null;    // null when no `posts` row exists for this ordinal
  dayLabel: string;         // formatted day-of-week + date for the column header
  cells: Record<Platform, GridCell>;
};

type SectionRow = {
  postOrder: number;
  postId: string;
  postText: string;
  scheduledTime: Date;      // THIS (postId, platform) row's scheduledTime — per-network offset surfaces
  status: "pending" | "posted" | "cancelled";
  canCancel: boolean;       // D-S2-7 gate result, pre-computed server-side
  canRestore: boolean;      // D-S2-21 gate result, pre-computed server-side
};

type Section = {
  platform: Platform;
  rows: SectionRow[];
};
```

**Building the columns.** For each `postOrder` from `1` to `batch.totalPosts`:
- Find the `posts` row at that ordinal (may be absent).
- For each platform, cell = `scheduled` iff a `scheduled_posts` row exists for `(postId, platform)` with `status IN ('pending', 'posted')`; else `absent`.
- Day label = formatted date from `MIN(scheduled_posts.scheduledTime)` across this post's platforms, filtered to rows where `status !== 'cancelled'`. If no non-cancelled rows exist (fully-cancelled post, OR no writer has populated `scheduled_posts` yet — the present-day reality), fall back to `batch.createdAt + (postOrder - 1) days` so the column still has a meaningful header.

**Building the sections.** For each platform in fixed order (Facebook → Instagram → LinkedIn):
- Select every `scheduled_posts` row for that platform across all posts in the batch (all statuses — `pending`, `posted`, `cancelled`). The section is the truth about what was set to publish to that network, including what was cancelled.
- For each row: `postId`, `postText` (from the matching `posts` row), `scheduledTime` (this row's value), `status`.
- Sort by `postOrder` ASC.
- Pre-compute the gates server-side:
  - `canCancel` = post is live (`status !== 'cancelled'`) AND post has at least one `scheduled_posts` row with `status='pending' AND scheduledTime > now()` AND no row with `status='posted'`. (D-S2-7.)
  - `canRestore` = post row is `'cancelled'` AND post has at least one `scheduled_posts` row with `status='cancelled' AND scheduledTime > now()` AND no row with `status='posted'`. (D-S2-21.)
- The server re-applies these gates inside `cancelPost` / `restorePost`; the UI hide is affordance only, not a security boundary.

### 4. `<BatchDetailView />` (server) — layout

Editorial pattern B (`max-w-3xl mx-auto space-y-8`). Header (Fraunces). `<NetworkDayGrid columns={columns} />`. Per-network sections in fixed order. Footer `[Cancel batch]` (Stage-1 `<CancelBatchDialog />` via the existing trigger wrapper).

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CancelBatchTrigger } from "./cancel-batch-trigger";
import { NetworkDayGrid } from "./network-day-grid";
import { BatchPostListRow } from "./batch-post-list-row";

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export function BatchDetailView({ batch, postRows, scheduledRows, now }: Props) {
  const { columns, sections } = shape({ batch, postRows, scheduledRows, now });

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-3">
        <Link
          href="/schedule"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to Scheduled
        </Link>
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          Batch {batch.batchOrdinalInPeriod} · Upcoming
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
        <CancelBatchTrigger batchId={batch.id} totalPosts={postRows.length} />
      </footer>
    </div>
  );
}
```

`scroll-mt-24` gives a comfortable offset below any fixed header so the anchor jump lands cleanly. The platform label `"LinkedIn"` is mixed-case; the `<h2>` uses `font-fraunces` with no `capitalize` utility — the map is the source of truth (`linkedin` → `"LinkedIn"`, not `"Linkedin"`).

### 5. `<NetworkDayGrid />` (server — no state)

Renders an HTML `<table>` (semantic + accessible). One header row of day labels; one body row per platform. Each body row's label cell AND each data cell wraps a native `<a href="#network-{platform}">` so a click anywhere on the row jumps to the section.

```tsx
import { Check, X } from "lucide-react";

const PLATFORM_LABEL: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

export function NetworkDayGrid({ columns }: { columns: GridColumn[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="p-3 text-left font-medium text-muted-foreground" />
            {columns.map((col) => (
              <th
                key={col.postOrder}
                scope="col"
                className="p-3 text-center font-medium text-muted-foreground whitespace-nowrap"
              >
                <span className="block text-xs uppercase tracking-wide">
                  Day {col.postOrder}
                </span>
                <span className="block text-xs">{col.dayLabel}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(["facebook", "instagram", "linkedin"] as const).map((platform) => (
            <tr
              key={platform}
              className="border-b border-border last:border-0 hover:bg-muted/60 focus-within:bg-muted/60 transition-colors"
            >
              <th scope="row" className="p-0">
                <a
                  href={`#network-${platform}`}
                  className="flex items-center gap-2 px-3 py-3 text-left font-medium text-foreground cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring"
                >
                  {PLATFORM_LABEL[platform]}
                </a>
              </th>
              {columns.map((col) => {
                const cell = col.cells[platform];
                const label =
                  cell.kind === "scheduled" ? "scheduled" : "not scheduled";
                return (
                  <td key={col.postOrder} className="p-0 text-center align-middle">
                    <a
                      href={`#network-${platform}`}
                      aria-label={`${PLATFORM_LABEL[platform]} day ${col.postOrder} — ${label}`}
                      className="block px-3 py-3 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-ring"
                    >
                      {cell.kind === "scheduled" ? (
                        <Check className="inline size-4 text-primary" aria-hidden />
                      ) : (
                        <X className="inline size-4 text-muted-foreground/60" aria-hidden />
                      )}
                    </a>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Notes:
- Native `<a href="#...">` gives free scroll, keyboard focus, and browser back-button parity per §6.9.
- Smooth scroll lives at the document level (DESIGN.md §11 global `scroll-behavior` rule, automatically disabled by the global `prefers-reduced-motion: reduce` media query). No JS scroll handler needed.
- **Architected for new networks.** Appending `"google_business_profile"` (or `"x"`) to the `PLATFORMS` constant + `PLATFORM_LABEL` map adds a fourth row to the grid AND a fourth section under it, with no further restructuring.
- The grid scrolls horizontally on narrow viewports (`overflow-x-auto`) so 9-column Pro batches stay legible on mobile without the cells collapsing.

### 6. `<BatchPostListRow />` (client — holds dialog state)

One row per `(postId, platform)` `scheduled_posts` row inside a per-network section. Renders day label + per-network scheduled time + post text + the appropriate action (`[Cancel]` for live rows when `canCancel`; `[Restore]` for cancelled rows when `canRestore`).

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CancelPostDialog } from "./cancel-post-dialog";
import { RestorePostDialog } from "./restore-post-dialog";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function BatchPostListRow({
  row,
  batchId,
}: {
  row: SectionRow;
  batchId: string;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const isCancelled = row.status === "cancelled";

  const dow = DOW[row.scheduledTime.getDay()];
  const date = row.scheduledTime.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = row.scheduledTime.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const containerCls = isCancelled
    ? "rounded-2xl border border-border bg-muted/30 p-6 italic space-y-3"
    : "rounded-2xl border border-border bg-card p-6 shadow-soft space-y-3";

  return (
    <div className={containerCls}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
          Day {row.postOrder} — {dow} {date} · {time}
          {isCancelled && (
            <span className="ml-2 normal-case font-normal">(Cancelled)</span>
          )}
        </p>
        {row.canCancel && !isCancelled && (
          <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
            Cancel
          </Button>
        )}
        {row.canRestore && isCancelled && (
          <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(true)}>
            Restore
          </Button>
        )}
      </div>
      <p
        className={
          isCancelled
            ? "text-base leading-7 text-muted-foreground line-clamp-3"
            : "text-base leading-7 text-foreground line-clamp-3"
        }
      >
        {row.postText}
      </p>

      {row.canCancel && !isCancelled && (
        <CancelPostDialog
          postId={row.postId}
          batchId={batchId}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
        />
      )}
      {row.canRestore && isCancelled && (
        <RestorePostDialog
          postId={row.postId}
          batchId={batchId}
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
        />
      )}
    </div>
  );
}
```

**Restore UI affordance decision (locked).** Cancelled posts remain visible inside each per-network section as greyed `bg-muted/30 italic` rows with a `[Restore]` button. Rationale: this keeps the user's mental model intact — the post is right where they expect to find it; the grid X cell is the at-a-glance signal; the row is the action surface. The spec leaves the choice to task-15 (§5.3 / §6.9 amendment "task-15 to decide"); this is the chosen pattern. A separate "Cancelled" section below the network sections was considered and rejected as more cognitive load with no payoff.

### 7. `<CancelPostDialog />` (client)

Mirrors the Stage-1 dialog patterns: `useTransition`, Sonner toasts, calls the server action. **Button variant is `outline` (NOT `destructive`)** — cancel is reversible per §6.11. Copy is the §6.11 verbatim text.

```tsx
"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cancelPostAction } from "@/app/(app)/(onboarded)/schedule/[batchId]/actions";

export function CancelPostDialog({
  postId,
  batchId,
  open,
  onOpenChange,
}: {
  postId: string;
  batchId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelPostAction(postId, batchId);
      if (!result.ok) {
        toast.error(
          result.error === "already_posted"
            ? "Already posted, can't cancel."
            : "Couldn't cancel this post.",
        );
        return;
      }
      toast.success("Post cancelled. Restore it from this page.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Cancel this post?
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-base leading-7 text-muted-foreground">
          It will be unscheduled on every network it was set to publish on. You
          can restore it from this page later. The image stays attached.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep post
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Cancelling…" : "Cancel post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 8. `<RestorePostDialog />` (client)

Mirrors the cancel dialog shape. Primary button variant is `default` (champagne) — restore is a constructive action.

```tsx
"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { restorePostAction } from "@/app/(app)/(onboarded)/schedule/[batchId]/actions";

export function RestorePostDialog({
  postId,
  batchId,
  open,
  onOpenChange,
}: {
  postId: string;
  batchId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await restorePostAction(postId, batchId);
      if (!result.ok) {
        toast.error(
          result.error === "not_restorable"
            ? "This post can't be restored."
            : "Couldn't restore this post.",
        );
        return;
      }
      toast.success("Post restored.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Restore this post?
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-base leading-7 text-muted-foreground">
          It will be re-scheduled on every network it was originally set to
          publish on. The image is still attached.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Not now
          </Button>
          <Button
            variant="default"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Restoring…" : "Restore post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 9. Voice & tokens

- Fraunces for the page title + section h2s + dialog titles (DESIGN.md §4).
- Editorial layout pattern B (DESIGN.md §8): `max-w-3xl mx-auto`, `space-y-8`.
- Cancel button = `outline` (NOT `destructive`) per §6.11 — the action is reversible.
- Restore button = `default` (champagne primary) — constructive action.
- `scroll-mt-24` on each per-network section so anchor jumps land cleanly below any fixed header.
- Horizontal scroll on the grid container so 9-column Pro batches stay legible on mobile.
- No exclamation points (§14).

## Acceptance Criteria

- [ ] `/schedule/[batchId]` exists; bad/foreign batchIds return `notFound()`. The previous 404 from `<ScheduledBatchBox />`'s `{N} posts` link is resolved.
- [ ] Header renders `← Back to Scheduled`, `BATCH {ordinal} · UPCOMING`, theme (Fraunces), and `importantThing` if present.
- [ ] **Network × Day grid** renders with rows = `[Facebook, Instagram, LinkedIn]` and columns = `batch.totalPosts` (NOT hardcoded to 7). A 9-post Pro batch renders 9 columns; a 7-post batch renders 7.
- [ ] Each grid cell = ✓ iff a `scheduled_posts` row exists for `(postId, platform)` with `status IN ('pending', 'posted')`; otherwise ✗. `'cancelled'` rows and missing rows both render as ✗.
- [ ] Column header day labels derive from `MIN(scheduled_posts.scheduledTime)` per post (filtered to non-cancelled rows) with the `batch.createdAt + (ordinal - 1) days` fallback when no such row exists.
- [ ] Each grid row (label cell + every data cell) is wrapped in a native `<a href="#network-{platform}">` anchor so a click anywhere on the row jumps to the section. Hover state (`bg-muted/60`) and `focus-visible:ring` present.
- [ ] Below the grid, the page renders one section per platform in the fixed order Facebook → Instagram → LinkedIn. Each section's container carries `id="network-{platform}"` matching the grid-row anchors.
- [ ] Inside each section, every post with a `scheduled_posts` row for that platform appears as a row — including `'cancelled'` rows (greyed, italic, with `[Restore]` when the D-S2-21 gate is open).
- [ ] Per-row scheduled time = the `scheduled_posts.scheduledTime` for THAT `(postId, platform)` pair (the per-network offset surfaces — 9:00 / 9:05 / 9:10).
- [ ] Live rows show `[Cancel]` only when the D-S2-7 gate is open (at least one `pending` row for the post with `scheduledTime > now()`, no `posted` row). Clicking opens `<CancelPostDialog />` with §6.11 copy verbatim; **button variant is `outline`**, not `destructive`.
- [ ] Cancelled rows show `[Restore]` only when the D-S2-21 gate is open. Clicking opens `<RestorePostDialog />`.
- [ ] On successful `cancelPostAction`: toast `"Post cancelled. Restore it from this page."`; page revalidates; the row flips to greyed `[Restore]` variant; the corresponding column's cells flip ✓ → ✗.
- [ ] On `already_posted` error: toast `"Already posted, can't cancel."`; dialog closes.
- [ ] On successful `restorePostAction`: toast `"Post restored."`; page revalidates; the row returns to live; the column's cells flip ✗ → ✓.
- [ ] Footer `[Cancel batch]` opens the Stage-1 `<CancelBatchDialog />` with the right `batchId` + `totalPosts`.
- [ ] **Present-day empty state.** When the batch has no `scheduled_posts` rows at all (Phase-4 cron hasn't shipped — the production reality at task land), the grid renders all-✗ and each section reads `"No posts scheduled to {Network} yet."` — neutral copy, not alarming.
- [ ] No `revalidatePath('/library')` in the cancel action. The image was NOT moved.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- **Production reality at task land.** No writer populates `scheduled_posts` rows yet in production (Phase-4 cron is deferred per §0). All live `scheduling` / `completed` batches will render all-✗ in the grid and empty per-network sections until that writer ships. Code the page to read live data so it lights up automatically when the cron lands — no further code change should be needed. (See §5.3 amendment.)
- The cancel availability gate (D-S2-7) and restore availability gate (D-S2-21) are restated in step 3 and are load-bearing UI logic — the server re-checks inside `postService.cancelPost` / `postService.restorePost`, so the UI gates are affordance hides, not security boundaries.
- `batchOrdinalInPeriod` lives on `weekly_batches` already; Stage-2 does not renumber after eviction.
- The previous draft's `<PostDaySlot />` is retired entirely. It hardcoded `for (order = 1..7)` and was structured as a vertical column of day-slots — both incompatible with §6.9 / D-S2-15.
- The previous draft's `revalidatePath('/library')` in `cancelPostAction` is removed. Cancel no longer moves images to the Library per the Cancel-vs-Delete contract; only `deleteBatchForever` does in Stage-2; the future `deletePost` (D-S2-22) is the per-post path that will reinstate the `/library` revalidation when it ships.
- Per-network cancel UI affordance is deferred. The service layer supports `cancelPost(postId, platform)` but Stage-2 UI calls whole-post only (§6.9 / D-S2-6). The dialog copy makes the cross-network scope explicit so the user knows what they're confirming.

## Out of scope

- Editing post text from the detail page. Read-only + cancel + restore only in Stage 2.
- Drag-to-reorder. Deferred (named in spec §0).
- Per-network cancel UI (service layer supports it; Stage-2 UI does whole-post only).
- True per-post `deletePost` destructive UI. Reserved (D-S2-22 / §8) for a future spec — when it ships, it will be the path that fills the Image Library from per-post flows and triggers AI per-network regeneration.
- Calendar view across multiple batches.
- Loading skeletons — server-rendered, instant.
