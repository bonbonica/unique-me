# Scheduled Page & Create Posts Flow Redesign (Stage-1)

## 0. Status of items flagged this revision

### Resolved (locked into the spec body)

- The sidebar collapses to a 2-stage flow: **Create Posts**, **Image Library**, **Scheduled**, **Settings**. "My Posts" is removed.
- **Create Posts** becomes the hub for all unscheduled batches (`reviewing`, `cancelled`) and the entry point for generating new ones.
- **Scheduled** (the renamed `/schedule` page) shows color-coded boxes for batches in the current 30-day quota window (`scheduling` → upcoming) plus a collapsible Past Batches list (`completed` only).
- Stage-1 derives every batch state from `weeklyBatches.status` alone — no reads from `scheduled_posts`. The `currently_posting` (green) box variant and the posted-vs-queued cancel split are built as **dormant** contracts that activate when Phase 4 (`scheduleService`) and Phase 7 (`postingService`) ship.
- The top pill copy is unified across plans: Starter/Pro show `"N batches left"` under cap and `"Resets in Nd"` at cap; Trial shows `"Trial · 1 batch"` before use and `"Trial used · Upgrade"` (link to `/pricing`) after.
- Past Batches is windowed against the user's rolling 30-day quota anchor (`subscriptions.periodStartDate`), the same rule for all three plans. Cancelled batches are excluded — they live on Create Posts.

### Items deliberately deferred (named so they don't sneak in)

- **Soft-delete system** — Delete → Deleted-posts trash → restore or 30-day auto-purge; image returns to Image Library. Requires background-job infrastructure that does not exist yet. Spec separately after Phase 4.
- **Phase 4 — scheduling infrastructure.** `scheduleService.create/autoSchedule/update/cancel`, the calendar UI, the cron poller at `/api/cron/post-scheduler`. The new Scheduled page is their visual home when they land, but no service work happens in this spec.
- **Phase 7 — posting infrastructure.** `postingService.postToFacebook/Instagram/LinkedIn`, OAuth flows for connected accounts, retry semantics, success notifications.
- **Image Library page** — no changes. Same route, same placeholder. Stays in the sidebar between Create Posts and Scheduled.
- **Wizard internals** — `NetworkWizard`, `WizardStep`, `WizardSummary`, `LockedSummary`, edit/regenerate dialogs all stay as-is. This redesign rewires how users get into them, not how they work.
- **Route renames** — `/create`, `/posts`, `/schedule` keep their pathnames. Only the sidebar label for `/schedule` changes ("Schedule" → "Scheduled").

---

## 1. Decisions locked

| # | Decision |
|---|---|
| **D-S1** | Sidebar items, top to bottom: **Create Posts** (`/create`), **Image Library** (`/library`), **Scheduled** (`/schedule`), **Settings** (`/settings`). "My Posts" is removed. The `/posts` route stays as the wizard target, reached only by clicking a card on Create Posts. |
| **D-S2** | **Create Posts is a hub.** Two top buttons: `[Start new batch]` and `[See scheduled posts →]`. Below: stacked cards for each unscheduled batch (`status ∈ {reviewing, cancelled}`). Below cards: the existing `<GenerateForm />` / `<QuotaGatedScreen />` / `<TrialGatedScreen />` chain, unchanged in behavior. |
| **D-S3** | **Cards open the existing wizard.** Each card on Create Posts links to `/posts?batchId={id}`. `NetworkWizard` and `LockedSummary` are untouched. |
| **D-S4** | **Scheduled page is plan-agnostic.** Boxes render only when batches exist. Trial (1 box max), Starter (1 box max), Pro (up to 4 boxes) share one layout. Plan affects only the top pill copy. |
| **D-S5** | **Stage-1 box states come from `weeklyBatches.status` alone.** `status='scheduling'` → **UPCOMING** (blue). `status='completed'` → Past Batches row. `status='cancelled'` → lives on Create Posts, never appears on Scheduled. The **CURRENTLY POSTING** (emerald) variant is built into the box component but is never produced by the Stage-1 data layer. |
| **D-S6** | **Cancel from Scheduled, Stage-1.** Confirm dialog says `"All N posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule."` `stopBatch()` keeps its current Phase-3 behavior — flips `scheduling → cancelled`, preserves posts/selections. No service-layer changes in Stage-1. |
| **D-S7** | **Cancel dialog dormant contract.** The dialog component accepts `alreadyPostedCount: number` (default `0`) and `queuedCount: number` (default `totalPosts`). The split block ("X already posted, M to be cancelled") only renders when `alreadyPostedCount > 0`. Stage-1 always passes `0`. When Phase 7 ships, the data layer fills the real counts and the dialog activates the split without component changes. |
| **D-S8** | **Past Batches window is the rolling 30-day quota period, all plans.** Anchored on `subscriptions.periodStartDate` (the column shipped in Phase 4 task-01). Same anchor logic as `subscriptionService.getProQuotaState()` for Pro — extended to Trial/Starter for the purpose of this page's windowing only (no other behavior changes). |
| **D-S9** | **Past Batches excludes cancelled batches.** A cancelled batch lives on Create Posts as a re-schedulable card, not in Past Batches. Only `status='completed'` rows appear. (In Stage-1 production this list is always empty — no posting-service yet to mark anything `completed`.) |
| **D-S10** | **Batch ordinal label rule.** Pro: `BATCH 1`, `BATCH 2`, ... using `weeklyBatches.batchOrdinalInPeriod` (1–4). Trial / Starter: just `BATCH` — they only ever have one current-period batch at a time, so no disambiguation is needed. |
| **D-S11** | **Top pill, Starter & Pro.** Under cap: `"{N} batches left"` where `N = max - used`. At cap: `"Resets in {N}d"` where `N = ceil((periodEndsAt - now) / 1d)`. Same component, same hydration sentinel as Phase 4 task-14. |
| **D-S12** | **Top pill, Trial.** Before any batch exists: `"Trial · 1 batch"`. After any batch exists (in any status, including cancelled): `"Trial used · Upgrade"` — whole pill is wrapped in `<Link href="/pricing">`. No `"resets"` wording for Trial. |
| **D-S13** | **Card state chips on Create Posts.** `reviewing` → **IN REVIEW** (champagne tint). `cancelled` → **CANCELLED — re-schedule** (warning tint). One chip per card, sits next to the title. |
| **D-S14** | **Hub form collapse rule.** When at least one unscheduled batch exists, the inline `<GenerateForm />` is collapsed behind the `[Start new batch]` button (click to expand). When zero unscheduled batches exist, the form is expanded by default — fresh-state users see the form immediately. Gated screens (`<TrialGatedScreen />`, `<QuotaGatedScreen />`) take the form's slot when applicable, exactly as today. |
| **D-S15** | **Empty Scheduled page.** When the current-period query returns zero `scheduling` and zero `completed` batches, render a one-line empty state + `[Start a new batch →]` button linking to `/create`. |
| **D-S16** | **No new schema migration.** This spec touches no Drizzle tables. `scheduled_posts`, `connected_accounts`, `post_logs` already exist (shipped earlier with `scheduleService`/`postingService` stubs). |
| **D-S17** | **No new `canGenerate` reason codes.** Existing reasons (`trial_batch_exists`, `weekly_cap_active`, `monthly_cap_active`, `starter_platforms_overage`, `plan_inactive`) cover every gating case on the hub. The new "1+ unscheduled batches present" condition is a render-time concern, not a gate. |

---

## 2. End-to-end flow this spec enables

### 2.1 Trial user with no batch yet

Lands on `/create`. Pill reads `"Trial · 1 batch"`. Hub shows no cards (no unscheduled batches), `<GenerateForm />` is expanded by default. User generates a batch → redirected to `/posts?batchId={id}` (existing flow). On return to `/create`, the form is replaced by `<TrialGatedScreen />` (D20, unchanged). Pill flips to `"Trial used · Upgrade"`.

### 2.2 Trial user with a cancelled batch

Lands on `/create`. Pill reads `"Trial used · Upgrade"`. Hub shows one card: `BATCH · CANCELLED — re-schedule`, theme + detail + counts + `[Open →]`. Below the card, `<TrialGatedScreen />` (the gated branch persists because `getMostRecentBatch` returns the cancelled row). User clicks `[Open →]` → `/posts?batchId={id}` → existing cancelled-recoverable flow.

### 2.3 Starter user, mid-period

Pill: `"1 batch left"` (under cap). After generating: pill flips to `"Resets in Nd"`. On `/scheduled`: one blue UPCOMING box with theme, detail, network counts, total, `[Cancel batch]`. No past batches.

### 2.4 Pro user, 2 batches in flight

Pill: `"2 batches left"`. On `/create`: two cards — one `IN REVIEW`, one `CANCELLED — re-schedule`. Form collapsed behind `[Start new batch]`. On `/scheduled`: no boxes yet (none in `scheduling` state).

### 2.5 Pro user, 4 batches: 2 scheduling, 1 reviewing, 1 cancelled

- Pill: `"0 batches left"` → `"Resets in 12d"` (at cap).
- Create Posts: 2 cards (`IN REVIEW` + `CANCELLED`). Form is hidden — `<QuotaGatedScreen variant="monthly_quota">` renders below cards instead of the form. `[Start new batch]` button is disabled with a tooltip.
- Scheduled: 2 UPCOMING boxes, labeled `BATCH 1 · UPCOMING` and `BATCH 2 · UPCOMING` (using `batchOrdinalInPeriod`).

### 2.6 User cancels a scheduling batch

User opens `/scheduled`, clicks `[Cancel batch]` on a blue box. Dialog: `"All 7 posts will be cancelled. The batch will return to Create Posts so you can edit and re-schedule."` Confirm → `stopBatch()` flips `scheduling → cancelled`. The box disappears from Scheduled, the batch reappears as a `CANCELLED — re-schedule` card on `/create`.

### 2.7 Past batches collapsible

In Stage-1, the Past Batches section toggles open and shows the empty state: `"No finished batches in this period."` When Phase 7 ships and batches reach `completed`, the same component renders compact dated rows with theme + total + ✓.

### 2.8 Dormant: currently-posting batch (Phase 4 + 7)

When `scheduleService` starts inserting `scheduled_posts` rows for a batch and the cron starts marking some `posted`, `getScheduledViewForUser()` flips that batch's `derivedState` from `"upcoming"` to `"currently_posting"`. The `<ScheduledBatchBox />` component already has the emerald variant — no UI change. The cancel dialog's `alreadyPostedCount` becomes non-zero, the split block lights up, and `stopBatch()` (Phase 4 task) preserves the posted rows.

---

## 3. State → surface mapping (Stage-1)

| `weeklyBatches.status` | Surface              | State chip / box                       | Action                |
|------------------------|----------------------|----------------------------------------|-----------------------|
| `reviewing`            | Create Posts hub     | **IN REVIEW** card (champagne chip)    | `[Open →]` → `/posts?batchId={id}` |
| `cancelled`            | Create Posts hub     | **CANCELLED — re-schedule** card       | `[Open →]` → `/posts?batchId={id}` |
| `scheduling`           | Scheduled — current  | **UPCOMING** box (blue)                | `[Cancel batch]`      |
| `completed`            | Scheduled — past     | compact dated row, ✓                   | (read-only)           |
| `in_progress`          | (defensive — redirected to `/create` per existing post-page logic; never reaches a card) | — | — |
| *(dormant)*            | Scheduled — current  | **CURRENTLY POSTING** box (emerald)    | `[Cancel batch]` w/ split — Phase 4+7 only |

---

## 4. File and folder layout

```
src/
├── app/
│   └── (app)/
│       └── (onboarded)/
│           ├── create/
│           │   └── page.tsx                       MODIFIED — hub layout (cards above existing form)
│           └── schedule/
│               └── page.tsx                       MODIFIED — replace placeholder with hub
├── components/
│   ├── create/
│   │   ├── unscheduled-batch-list.tsx             NEW — list wrapper + top buttons
│   │   └── unscheduled-batch-card.tsx             NEW — single card with state chip
│   ├── dashboard/
│   │   ├── sidebar.tsx                            MODIFIED — drop My Posts, rename label
│   │   └── quota-countdown-pill.tsx               MODIFIED — Trial variant, copy table
│   └── schedule/
│       ├── scheduled-page.tsx                     NEW — orchestrator
│       ├── scheduled-batch-box.tsx                NEW — color-coded box (all 3 variants)
│       ├── past-batches-list.tsx                  NEW — collapsible row list
│       └── cancel-batch-dialog.tsx                NEW — confirm dialog w/ dormant split
└── lib/
    └── services/
        ├── post-service.ts                        MODIFIED — add getUnscheduledBatchesForUser +
        │                                            getScheduledViewForUser
        └── subscription-service.ts                MODIFIED (if needed) — expose periodStartDate
                                                     on non-Pro snapshots for the window helper

specs/scheduled-and-create-redesign/
└── verification.md                                NEW — manual E2E runbook (task 13)
```

No new Drizzle migration. No new pricing constants.

---

## 5. Service-layer API

### 5.1 `postService.getUnscheduledBatchesForUser(userId)` — new

```ts
export type UnscheduledBatchCard = {
  id: string;
  theme: string;
  importantThing: string;
  totalPosts: number;
  status: "reviewing" | "cancelled";
  counts: { facebook: number; instagram: number; linkedin: number };
};

export async function getUnscheduledBatchesForUser(
  userId: string,
): Promise<UnscheduledBatchCard[]>;
```

Returns all rows in `weekly_batches` for the user where `status ∈ {'reviewing','cancelled'}`, sorted by `createdAt DESC`. `counts` are computed from `post_selections` joined to `posts` filtered by `batchId`, grouped by `platform`. Pattern mirrors `src/components/posts/network-wizard.tsx:52–64`.

### 5.2 `postService.getScheduledViewForUser(userId)` — new

```ts
export type BatchBoxData = {
  id: string;
  ordinal: number | null;          // weeklyBatches.batchOrdinalInPeriod
  theme: string;
  importantThing: string;
  totalPosts: number;
  counts: { facebook: number; instagram: number; linkedin: number };
  derivedState: "upcoming" | "currently_posting";  // Stage-1 always "upcoming"
  alreadyPostedCount: number;       // Stage-1 always 0
  queuedCount: number;              // Stage-1 always === totalPosts
};

export type PastBatchRow = {
  id: string;
  ordinal: number | null;
  theme: string;
  totalPosts: number;
  completedAt: Date;                // weeklyBatches.createdAt for Stage-1
};

export type ScheduledView = {
  current: BatchBoxData[];
  past: PastBatchRow[];
  periodStartDate: Date;
  periodEndsAt: Date;
};

export async function getScheduledViewForUser(
  userId: string,
): Promise<ScheduledView>;
```

Window: anchor = `subscriptions.periodStartDate`. Current period start = `floor((now - anchor) / 30d) * 30d + anchor` (same JS formula as `getProQuotaState()`, D-A11). `current` = batches with `status='scheduling'` and `createdAt >= currentPeriodStart`. `past` = batches with `status='completed'` and `createdAt >= currentPeriodStart`. Both sorted by `createdAt ASC` (oldest first — Pro ordinals 1→4 read naturally).

Stage-1: `derivedState` is unconditionally `"upcoming"` for every current row. `alreadyPostedCount` is unconditionally `0`. `queuedCount` mirrors `totalPosts`. The dormant contract documents what these fields *will* mean when Phase 4 lands; the component reads them today as zeros.

### 5.3 `subscriptionService.checkSubscription` — Trial/Starter periodStartDate

Verify the snapshot returned by `checkSubscription()` exposes `periodStartDate` and `periodEndsAt` for non-Pro plans. If today's snapshot only carries them on the Pro branch, extend the shape so the Scheduled view helper has the anchor for all plans. Migration-wise this is a read-only widening; no schema work.

If the existing snapshot already passes them through (D-S16 says no schema work needed), this task is a no-op verification step.

### 5.4 `postService.stopBatch` — UNCHANGED in Stage-1

Current behavior at `src/lib/services/post-service.ts:898–939` already does exactly what Stage-1 needs: `scheduling → cancelled`, posts/selections preserved. No edits.

The dormant Phase-7 follow-up extends this function to mark future `scheduled_posts` rows as cancelled while preserving posted ones — that work is **out of scope for this spec** and lives in the Phase-7 backlog.

---

## 6. UI requirements

### 6.1 `<DashboardSidebar />` — drop "My Posts", rename "Schedule"

In `src/components/dashboard/sidebar.tsx:30–36`, the `DASHBOARD_NAV_ITEMS` const becomes:

```ts
export const DASHBOARD_NAV_ITEMS: readonly NavItem[] = [
  { label: "Create Posts",  href: "/create",   icon: Sparkles },
  { label: "Image Library", href: "/library",  icon: ImageIcon },
  { label: "Scheduled",     href: "/schedule", icon: Calendar },
  { label: "Settings",      href: "/settings", icon: Settings },
] as const;
```

The `FileText` import is removed if no other module uses it. `isActive` prefix-aware matching keeps working: `/posts/{id}/review` no longer highlights anything (intentional — no sidebar item points there).

### 6.2 `<QuotaCountdownPill />` — Trial variant + copy

Extend the prop union:

```ts
type Props =
  | { variant: "trial"; used: boolean }
  | { variant: "starter"; batchesRemaining: number; nextResetAt: Date | null }
  | { variant: "pro"; batchesRemaining: number; periodEndsAt: Date };
```

Rendering:

- `trial` + `used: false` → `<Pill label="Trial · 1 batch" />`.
- `trial` + `used: true` → `<Link href="/pricing"><Pill label="Trial used · Upgrade" /></Link>`. Pill itself stays muted; the wrapping `<Link>` provides hover affordance.
- `starter` + `batchesRemaining > 0` → `<Pill label="1 batch left" />` (deterministic, no sentinel).
- `starter` + `batchesRemaining === 0` → `<CountdownPill>` with `Resets in {N}d`.
- `pro` + `batchesRemaining > 0` → `<Pill label="{N} batches left" />` (deterministic).
- `pro` + `batchesRemaining === 0` → `<CountdownPill>` with `Resets in {N}d`.

Starter and Pro at-cap share the `<CountdownPill>` mount-sentinel logic. The top-bar caller passes the right variant from `subscription.plan` + computed `batchesRemaining` + dates from the snapshot.

### 6.3 `<UnscheduledBatchCard />` — new

Card layout (mobile-first, single column):

```
┌──────────────────────────────────────────────┐
│ BATCH · IN REVIEW           (champagne chip) │
│ {theme}                                       │
│ {importantThing}                  (truncated) │
│                                               │
│ FB {n}  ·  IG {n}  ·  LI {n}  ·  {total}    │
│                                               │
│                                   [Open →]    │
└──────────────────────────────────────────────┘
```

Tokens (per DESIGN.md §9):
- Container: `bg-card rounded-2xl p-6 shadow-soft hover:shadow-lift transition-all duration-300`.
- Title row: `font-fraunces text-xl tracking-tight font-medium` for "BATCH ·"; the state chip uses `<Badge variant="default">` for `IN REVIEW` (champagne) and a warning-tinted custom chip for `CANCELLED — re-schedule` (`bg-amber-500/15 text-amber-300 border-amber-500/30`).
- Theme: `text-base text-foreground leading-7`.
- Detail (importantThing): `text-sm text-muted-foreground line-clamp-1`.
- Network row: `text-sm font-medium` with platform names; counts in `text-foreground`, separators (`·`) in `text-muted-foreground`. Total in same row, right-aligned.
- CTA: `<Button variant="default" size="sm" asChild><Link>Open →</Link></Button>` — champagne pill per DESIGN.md §9.

### 6.4 `<UnscheduledBatchList />` — new

```
[Start new batch] [See scheduled posts →]
─────────────────────────────────────────
{stacked UnscheduledBatchCard, gap-4}
```

- Top buttons row: `flex gap-3`. Primary: `[Start new batch]` (champagne pill). Secondary: `[See scheduled posts →]` (`variant="outline"`, links to `/schedule`).
- `[Start new batch]` behavior:
  - Under cap → toggles a sibling `<GenerateForm />` open. Initial state: collapsed when 1+ unscheduled batches exist (per D-S14); expanded when zero.
  - At cap → disabled with `<Tooltip>` reading "You've used all batches this period." (Or whatever the gated screen below already says — keep the tooltip concise.)
- Component is a server component fed by `getUnscheduledBatchesForUser()`. Pure presentational. Form toggle state lives in a small client wrapper at the page level so the cards themselves stay server-rendered.

### 6.5 `<ScheduledBatchBox />` — new

Box layout:

```
┌──────────────────────────────────────────────┐
│ BATCH {ordinal?} · {STATE}     (header strip)│  ← color-coded strip
├──────────────────────────────────────────────┤
│ {theme}                                       │
│ {importantThing}                              │
│                                               │
│ FB {n}  ·  IG {n}  ·  LI {n}                 │
│ {total} posts                                 │
│                                               │
│                          [Cancel batch]       │
└──────────────────────────────────────────────┘
```

Three `derivedState` variants:
- `upcoming` → header strip uses `bg-primary/15 text-primary border-primary/30` (champagne / blue family from DESIGN.md). Label: `BATCH {ordinal} · UPCOMING` (Pro) or `BATCH · UPCOMING` (Trial/Starter).
- `currently_posting` (**dormant**) → header strip `bg-emerald-500/15 text-emerald-300 border-emerald-500/30`. Label includes the live count: `BATCH {ordinal} · CURRENTLY POSTING`. Never rendered from real data in Stage-1; the variant exists so Phase 4 doesn't touch this component.
- *(no finished variant)* — completed batches render through `<PastBatchesList />` as rows, not boxes.

Cancel button visible on all box variants (even the dormant emerald one, since cancel-during-posting is the Phase-7 contract). In Stage-1 it only ever shows on `upcoming`.

### 6.6 `<PastBatchesList />` — new

Collapsible disclosure, closed by default:

```
▾ Past batches  (3)
   May 14   Spring blooms      7 posts ✓
   May 21   Mother's Day       7 posts ✓
   May 28   Memorial Day       9 posts ✓
```

- Disclosure trigger: chevron + label + count. Reuse `<details>`/`<summary>` (lightest accessible primitive) or a Radix `<Collapsible>` — pick whichever the codebase already uses for similar disclosures. Closed by default; pressing the trigger toggles `aria-expanded`.
- Empty state (Stage-1 normal case): `"No finished batches in this period."` — one line, `text-sm text-muted-foreground`. Render inside the disclosure body so it's only visible after the user expands.
- Rows: `flex items-center justify-between py-3 text-sm`. Date left, theme middle, total + ✓ right. No card chrome — these are read-only history entries.

### 6.7 `<CancelBatchDialog />` — new

Dialog (Radix or shadcn `<Dialog>`):

```
┌─────────────────────────────────────────┐
│ Cancel batch                             │
├─────────────────────────────────────────┤
│ All {N} posts will be cancelled. The     │
│ batch will return to Create Posts so you │
│ can edit and re-schedule.                │
│                                          │
│   (split block — Phase 7 only)           │
│   ┌─ Already posted (X)  ─────────┐     │
│   │  • Mon  • Tue  • Wed           │     │
│   └─────────────────────────────────┘     │
│   ┌─ Will be cancelled (M)  ──────┐     │
│   │  Thu · Fri · Sat · Sun         │     │
│   └─────────────────────────────────┘     │
│                                          │
│              [Keep batch]  [Cancel N]    │
└─────────────────────────────────────────┘
```

Props (committed at task time, dormant fields included):

```ts
type Props = {
  batchId: string;
  totalPosts: number;
  alreadyPostedCount?: number;   // default 0
  queuedCount?: number;          // default = totalPosts
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
};
```

Stage-1 rules:
- The lead copy ("All N posts will be cancelled...") always renders.
- The split block (Already posted / Will be cancelled) only renders when `alreadyPostedCount > 0`. In Stage-1, every call passes `0` (the default), so the block never renders.
- The primary destructive action label is `Cancel {queuedCount}` — in Stage-1 that equals total posts ("Cancel 7").
- Submit handler calls `stopBatch()` via a server action; on success, refreshes the Scheduled page and closes the dialog. Sonner toast (`info` variant per DESIGN.md §9) confirms: `"Batch cancelled — returned to Create Posts."`

### 6.8 `<ScheduledPage />` — new orchestrator

```
container mx-auto px-5 sm:px-8 lg:px-12
  └── max-w-3xl mx-auto
      ├── Header: "Scheduled" (Fraunces h1, text-3xl sm:text-4xl)
      ├── (top pill is already in the layout's top bar — not duplicated here)
      ├── Current period section
      │     ScheduledBatchBox × N  (gap-6)
      ├── PastBatchesList
      └── (empty state — only when current.length === 0 && past.length === 0)
```

Empty state:

```
You don't have any scheduled batches yet.
[Start a new batch →]
```

Reuses `editorial content page` pattern (DESIGN.md §8 pattern B). One column, max-w-3xl, generous vertical rhythm (`space-y-12` between Current + Past sections).

### 6.9 `<CreatePage />` (hub) — restructure

The existing `src/app/(app)/(onboarded)/create/page.tsx` flow stays:
1. Trial-batch-exists gate → `<TrialGatedScreen />`.
2. Paid `canGenerate` reasons → corresponding `<QuotaGatedScreen>` variant.
3. Allowed → render the form.

The new layout interleaves the unscheduled-batch list at the top of every non-redirect branch:

```tsx
const cards = await postService.getUnscheduledBatchesForUser(session.user.id);

// ... existing gate logic produces `belowSlot` (form OR gated screen)

return (
  <div className="max-w-3xl mx-auto space-y-12">
    <header>{/* "Create Posts" title */}</header>
    <UnscheduledBatchList
      cards={cards}
      hasCapacity={gate.allowed}
      showFormToggleButton
    />
    {belowSlot}
  </div>
);
```

Behavior matrix:

| Cards | gate.allowed | Below slot                    | `[Start new batch]` button |
|-------|--------------|-------------------------------|----------------------------|
| 0     | yes          | `<GenerateForm />` (expanded) | hidden (form is already up) |
| 0     | no           | `<QuotaGatedScreen />`        | hidden (gate explains why) |
| 1+    | yes          | `<GenerateForm />` (collapsed) | visible — toggles form |
| 1+    | no           | `<QuotaGatedScreen />`        | disabled w/ tooltip |
| 1+    | trial-exists | `<TrialGatedScreen />`        | hidden (one-batch rule) |

The hub title changes from "Create this week's posts" → **"Create Posts"** to match the sidebar label.

---

## 7. Error handling

### 7.1 No new reason codes

The `canGenerate` discriminated union already covers every gated state the hub needs. The new `[Start new batch]` button surfaces the existing gate text below the cards — same component (`<QuotaGatedScreen />`, `<TrialGatedScreen />`), same copy.

### 7.2 Stale card data

`getUnscheduledBatchesForUser()` is called server-side on every `/create` page render — no client-side cache. After cancelling a batch on `/scheduled`, the server action calls `revalidatePath('/create')` so the next navigation shows the new cancelled card immediately.

### 7.3 Race conditions on cancel

Two concurrent cancel requests for the same batch: `stopBatch()` already guards with a `WHERE status='scheduling'` clause (race-safe; one wins, the other returns `not_scheduling`). The dialog catches the error and shows a Sonner `error` toast: `"This batch was already cancelled."` Then refreshes.

### 7.4 Dormant contract — failure modes when Phase 4 lands

Documented here so Phase-4 work doesn't re-derive them:
- If `scheduled_posts` rows exist but none with `status='posted'` → batch stays `upcoming`.
- If any `scheduled_posts` row has `status='posted'` and at least one `status='pending' AND scheduledTime > now()` → batch flips to `currently_posting`.
- If all `scheduled_posts` rows are `status='posted'` → batch transitions to `weeklyBatches.status='completed'` (Phase-7 posting service writes this) and falls into the Past Batches list automatically.

---

## 8. What this spec deliberately does NOT cover

- **Soft-delete trash + 30-day auto-purge.** Separate spec, post-Phase-4.
- **Phase 4 scheduling service.** Cron, calendar UI, time-slot picker, auto-schedule, optimal-time logic. The new `<ScheduledBatchBox />` is the visual home when those land; service work is not in this spec.
- **Phase 7 posting service.** Facebook/Instagram/LinkedIn API calls, OAuth, retry. The dormant emerald box and split cancel dialog are the contract; service work is not in this spec.
- **`/posts` route changes.** The wizard stays where it is. Only the sidebar removes its top-level link.
- **Pricing or quota constant changes.** No edits to `src/lib/pricing.ts`.
- **`canGenerate` changes.** No new reason codes; no logic changes.
- **Stop reading `postsUsedThisMonth` / `regenerationsDuringTrial`.** Dead machinery from earlier phases; out of scope.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Sidebar removal of "My Posts" breaks deep-link discoverability | `/posts` route stays accessible via the cards on `/create`; users who bookmarked `/posts` directly still land in the resumable-batch fallback (existing behavior). |
| Stage-1 Past Batches always-empty looks broken | Empty-state copy explicitly says `"No finished batches in this period."` — implies "yet," not "broken." When Phase 7 ships, the same component populates. |
| Dormant emerald box variant rots between this spec and Phase 4 | Stage-1 verification task includes a Storybook-style ad-hoc render (or a dev-only route) to confirm the dormant variant renders cleanly against DESIGN.md tokens. |
| Cancel-dialog dormant split block diverges from real Phase-7 data | The prop names + types (`alreadyPostedCount: number`, `queuedCount: number`) are the contract. Phase 7 task wiring populates them; this dialog is unmodified at that point. |
| Pill copy unification breaks Phase 3/4 Starter assumptions | Phase 3's Starter pill copy was `"Next batch · Nd"`. Stage-1 changes it to `"1 batch left"` / `"Resets in Nd"` for parity with Pro. Confirm the Phase 3 banner + settings copy stays distinct (those surfaces still use `"Next batch"` phrasing where appropriate). |
| Trial pill linking to `/pricing` collides with existing TrialStrip | `<TrialStrip />` already exists separately and shows days-remaining in the trial. The pill is a *separate* surface. Confirm during implementation that both can coexist on the topbar without visual collision; if not, the Trial pill defers to TrialStrip until the trial ends. |
| Pro Trial-style "Trial used" state for Trial users with cancelled-only batches accidentally shows "Upgrade" CTA before the trial ends | `subscription.status === "trial"` AND any batch exists → show `"Trial used · Upgrade"`. This is intentional (trial cap = 1 lifetime). The wording is honest, not misleading. |
| `getScheduledViewForUser` joins `post_selections` and is slow for users with many batches | Stage-1 expected scale = ≤ 4 batches in window (Pro cap). Each batch ≤ 9 posts × 3 platforms = ≤ 108 selection rows per user per period. Single query with batch-id IN clause. No paging needed. |

---

## 10. Definition of done

- [ ] `src/components/dashboard/sidebar.tsx` updated: "My Posts" removed, "Schedule" → "Scheduled" label. Route stays `/schedule`. `FileText` import removed if unused elsewhere.
- [ ] `<QuotaCountdownPill />` accepts the new 3-variant union; Trial branches added; copy table matches D-S11 / D-S12. Hydration sentinel preserved.
- [ ] `postService.getUnscheduledBatchesForUser(userId)` returns `reviewing` + `cancelled` batches with correct per-network counts.
- [ ] `postService.getScheduledViewForUser(userId)` returns `{current, past, periodStartDate, periodEndsAt}` with Stage-1 zeros on the dormant fields.
- [ ] `<UnscheduledBatchCard />` and `<UnscheduledBatchList />` render per DESIGN.md tokens; card CTA navigates to `/posts?batchId={id}`.
- [ ] `<CreatePage />` shows cards above the form / gated screen; collapse rule per D-S14.
- [ ] `<ScheduledBatchBox />` includes all three variants (`upcoming`, `currently_posting`, dormant; never rendered from data in Stage-1).
- [ ] `<PastBatchesList />` collapsible closed by default; empty-state copy renders inside the body.
- [ ] `<CancelBatchDialog />` matches the dormant-contract prop signature; split block only renders when `alreadyPostedCount > 0`.
- [ ] `<ScheduledPage />` orchestrates current + past + empty state; empty CTA links to `/create`.
- [ ] `/schedule` page no longer shows the "Coming soon" placeholder; renders `<ScheduledPage />`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.
- [ ] Manual QA: every scenario in `verification.md` (task 13) passes.
- [ ] Dormant-variant smoke: ad-hoc render of `<ScheduledBatchBox derivedState="currently_posting" />` looks correct against DESIGN.md emerald tokens. (Captured in `verification.md`.)
- [ ] No edits to `src/lib/services/post-service.ts:stopBatch` (898–939).
- [ ] No new Drizzle migration generated. `pnpm db:generate` exits with "No schema changes" or equivalent.

---

## 11. After sign-off

13 tasks across 5 waves. Within-wave parallelism per the table:

| Wave | Tasks | Parallelism |
|---|---|---|
| 1 | 01, 02 | parallel within wave (both edit `post-service.ts` — split via a fresh file region so they don't conflict) |
| 2 | 03, 04 | parallel within wave (different files) |
| 3 | 05, 06, 07 | 05 + 06 parallel; 07 depends on 06 |
| 4 | 08, 09, 10, 11 | parallel within wave (11 depends on 08+09+10 for prop wiring) |
| 5 | 12, 13 | sequential — 12 must pass before 13 starts |
