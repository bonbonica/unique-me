# Task 06: Populate Cancelled Batches section on /cancelled-posts

## Status

pending

## Wave

2

## Description

Wave 1's task-03 created `/cancelled-posts` with two empty section shells. This task fills the first section ("Cancelled batches") with the user's cancelled `weeklyBatches` rows. Each row links into the existing cancelled-recovery flow (NetworkWizard in `cancelled` mode) at `/schedule-posts/[batchId]` — so a user clicking a cancelled batch lands in the editor where they can re-edit and re-schedule it (today's behavior preserved). The "Delete forever" affordance from the existing `delete-batch-forever-dialog.tsx` is exposed per-row.

## Dependencies

**Depends on:** task-01, task-02, task-03, task-04, task-05 (all of Wave 1)
**Blocks:** task-07 (we want the new home for cancelled batches to be live before stripping them from `/create`), task-08, task-09

**Context from dependencies:** task-03 created `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-batches-section.tsx` as a placeholder that returns an empty-state `<p>`. This task replaces the placeholder body with a real query + render. task-02 moved the cancelled-batch detail experience to `/schedule-posts/[batchId]` (NetworkWizard's `cancelled` mode renders there). task-01 / task-04 / task-05 wrap up sidebar / Currently Posting cleanup / legacy redirects — nothing in this task depends on their specifics beyond "they're done".

## Files to Create

None (writes happen inside the placeholder file from task-03).

## Files to Modify

- `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-batches-section.tsx` — replace placeholder with real data fetching + row rendering.
- `src/lib/services/post-service.ts` — if no helper exists, add a thin `getCancelledBatchesForUser(userId)` returning the user's cancelled `weeklyBatches` rows (with the fields needed to render a row: id, theme, importantThing, batchOrdinalInPeriod, createdAt, postCount). The existing `getUnscheduledBatchesForUser` (line 586) probably already returns cancelled batches mixed with reviewing — if so, prefer a dedicated query for clarity.

## Technical Details

### Implementation Steps

1. **Choose data path.** Read `src/lib/services/post-service.ts` around line 586 (`getUnscheduledBatchesForUser`). If it returns cancelled batches alongside reviewing batches, decide between:
   - Option A: Filter at the call site in the section component (`.filter(b => b.status === "cancelled")`).
   - Option B: Add a new typed helper `getCancelledBatchesForUser(userId)` that runs a dedicated query (`where(eq(weeklyBatches.userId, userId), eq(weeklyBatches.status, "cancelled"))`). Preferred — clearer intent, smaller payload, easier to extend.
2. **Update the section component.** `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-batches-section.tsx`:
   - Read the current user (via the project's auth helper — match what `/dashboard/page.tsx` uses today).
   - Call the cancelled-batches fetch.
   - If the result is empty, keep the existing empty-state `<p>` ("Nothing cancelled.").
   - If non-empty, render a list of rows. Each row should follow the existing `UnscheduledBatchList` row pattern (search `src/components/` for it) so the visual language stays consistent — reuse the same row component if it accepts a `cancelled` mode.
3. **Row contents** (per batch):
   - Batch identity line — Fraunces small heading: theme + ordinal (e.g. "Week 2 · Spring drops" or whatever today's card shows).
   - Cancelled-at timestamp (use `weeklyBatches.updatedAt` if that's what today's cancel flow stamps; otherwise `createdAt`). Format: `text-sm text-muted-foreground`.
   - Two actions: "Recover" (links to `/schedule-posts/[batchId]`, which renders NetworkWizard in `cancelled` mode for re-edit + re-schedule) and "Delete forever" (opens the existing `<DeleteBatchForeverDialog>` component).
4. **Reuse existing UI primitives** from the row component used by today's `UnscheduledBatchList` for cancelled cards. If extracting/reusing isn't clean, build a minimal row that visually matches per `DESIGN.md` § 9 (card-like, but rendered inside the section card — no double card chrome; use a `border-t border-border pt-4` divider between rows).
5. **Wire the Delete-forever dialog.** Import the existing `<DeleteBatchForeverDialog>` (file: search `src/components/` for it; per exploration it lives near `delete-batch-forever-dialog.tsx` and is wired into the existing cancelled-recovery cards on `/create`). Pass `batchId` and `mode` if it accepts those props (mirror today's usage).
6. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
7. Dev-server smoke test: create a batch, schedule it, cancel the batch (use today's "Stop entire batch" action), navigate to `/cancelled-posts`, confirm the batch appears in section 1 with both actions wired.

### Code Snippets

Section component sketch:

```tsx
// src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-batches-section.tsx
import { auth } from "@/lib/auth"; // or project equivalent
import { postService } from "@/lib/services/post-service";
import { CancelledBatchRow } from "./cancelled-batch-row"; // co-locate

export async function CancelledBatchesSection() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const batches = await postService.getCancelledBatchesForUser(session.user.id);

  return (
    <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-2xl font-medium tracking-tight font-fraunces">Cancelled batches</h2>
        {batches.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">{batches.length}</span>
        )}
      </header>
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing cancelled.</p>
      ) : (
        <ul className="divide-y divide-border">
          {batches.map((b) => (
            <li key={b.id} className="py-4">
              <CancelledBatchRow batch={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`getCancelledBatchesForUser` sketch:

```ts
// src/lib/services/post-service.ts (new helper)
async function getCancelledBatchesForUser(userId: string) {
  return db
    .select({
      id: weeklyBatches.id,
      theme: weeklyBatches.theme,
      importantThing: weeklyBatches.importantThing,
      batchOrdinalInPeriod: weeklyBatches.batchOrdinalInPeriod,
      createdAt: weeklyBatches.createdAt,
      updatedAt: weeklyBatches.updatedAt,
      // postCount: sql<number>`(select count(*) from ${posts} where ${posts.batchId} = ${weeklyBatches.id})`,
    })
    .from(weeklyBatches)
    .where(and(eq(weeklyBatches.userId, userId), eq(weeklyBatches.status, "cancelled"), isNull(weeklyBatches.deletedAt)))
    .orderBy(desc(weeklyBatches.updatedAt));
}
```

(Use whatever the actual schema column for "soft-delete" tombstoning is — per `quota-soft-delete.md` reference there's a `deletedAt`-style column. Mirror existing query patterns in the same file.)

### Notes on what NOT to change

- Do not delete the section component file from task-03 — only modify its body.
- Do not remove cancelled batches from `/create` here — task-07 owns that.
- Do not introduce a new restore-cancelled-batch action. The existing NetworkWizard `cancelled` mode at `/schedule-posts/[batchId]` is the recovery path.
- Do not start populating section 2 (single posts) — task-11 owns that.

## Acceptance Criteria

- [ ] `CancelledBatchesSection` queries cancelled batches for the current user and renders them as a list inside section 1.
- [ ] Empty state still renders "Nothing cancelled." when no cancelled batches exist.
- [ ] Each row shows batch identity, cancelled timestamp, "Recover" link (→ `/schedule-posts/[batchId]`), and "Delete forever" action (opens existing dialog).
- [ ] Cancelled batches no longer need to be surfaced on `/create` — task-07 will rely on this section being live.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
- [ ] Brand voice: no exclamation points; row copy stays minimal.

## Notes

- If `getUnscheduledBatchesForUser` already returns cancelled batches mixed in, leaving it as-is (and filtering at the call site) is acceptable IF task-07 will also rely on the same helper. Coordinate via the call-site filter — task-07 then changes the `/create` call site to filter cancelled out, while this task's call site filters cancelled in. Both paths use the same underlying query but distinct status filters.
- If `weeklyBatches.deletedAt` (tombstone) exists, the cancelled-batches query MUST filter `deletedAt IS NULL` to avoid showing soft-deleted batches.
