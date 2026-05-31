# Phase 3 — Subscription Gating

## 0. Status of items flagged this revision

### Resolved (locked into the spec body)

- Plan set is **Trial / Starter / Pro only**. No PAYG, no credits, no `creditService`.
- Pro pricing is **$19.99/mo** (overrides the $14.99 in `UniqueMe_App_Vision_and_Architecture.pdf`).
- Trial expiry behavior: **pauses**. The 7-day countdown stops, the 1-batch lifetime cap stays in force, no auto-expire lock.
- Weekly reset: **rolling 7 days from the last batch's `createdAt`**, regardless of batch status.
- Plan-change semantics: **upgrade mid-week = fresh batch immediately**; **downgrade/cancel mid-week = in-flight batch unaffected, no refund**.
- Starter platform cap (2 of 3) is a **one-time `profile.platforms` choice**, not a per-batch setting.
- Post-length (short/medium/long) is a **per-batch input** captured on `/create`, persisted on a new `weekly_batches.post_length` column.
- Day labels: **Day 1 = the day the batch was generated** (`createdAt` weekday in the user's timezone). Computed at render, not stored.
- New-batch-ready reminder: **in-app only** (dashboard banner + TopBar countdown). Email reminders deferred to Phase 4.

### Items deliberately deferred (named so they don't sneak in)

- **Payment plumbing.** Plan changes in Phase 3 happen via direct DB mutation (Drizzle Studio locally, Neon console in prod). Real upgrade/downgrade UI lands in Phase 5.
- **Image extras** (Pro 3-image, "Use my face", $0.50 regenerations). Image phase.
- **2x/day posting.** Phase 4 scheduling.
- **Smart trial-conversion screen.** Depends on image-regeneration count, which doesn't exist yet. Defer to image phase.
- **Email reminders.** Phase 4 notification surface.

### Item I'll propose, you red-line at review

- **In-app reminder placement.** Default proposal in § 6: a dashboard banner ("Next batch in X days") that only shows when the user can't yet generate; plus a countdown line on the TopBar plan pill. Open to a different home if you prefer.

---

## 1. Decisions locked

| # | Decision |
|---|---|
| **D1** | Plans: `free_trial`, `starter`, `pro`. No others in Phase 3. |
| **D2** | Pricing: Starter $9.99/mo · Pro $19.99/mo · Trial $0/7 days, full Pro features, no card. **Monthly only in Phase 3** — annual plans arrive with real payments in Phase 5. Pricing strings live in code constants (`src/lib/pricing.ts`), not the DB. |
| **D3** | Trial expiry: **paused, not locking**. When `now > trialEndDate` the day-counter stops but the 1-batch-lifetime cap stays — they can still generate that one batch whenever, just under "trial expired" copy. `checkSubscription` already does this implicitly (no row mutation on read); we extend the UI copy only. |
| **D4** | Weekly reset: rolling 7 days. `nextResetAt = lastBatch.createdAt + 7d`. Any batch status counts (cancelled batches do NOT free the quota — consistent with the trial cap from Phase 2). |
| **D5** | Plan-change resets: on `plan` change the rolling-7-day window restarts. A new column `subscriptions.plan_changed_at` tracks this explicitly (don't reuse `updatedAt` — it fires on unrelated bumps like `postsUsedThisMonth`). |
| **D6** | Starter platform cap: 2 of `{facebook, instagram, linkedin}`. Persisted on `profile.platforms`. Enforced at three sites: profile save, onboarding form UI, and `canGenerate` (which blocks with `starter_platforms_overage` if the cap is violated — defensive, since this state is only reachable via downgrade). |
| **D7** | Post-length: `"short" \| "medium" \| "long"`. Per-batch, captured in `/create` form, persisted on `weekly_batches.post_length`. Pro-only choice; Starter/Trial pass through with default `"medium"`. Affects the system prompt sent to Claude. |
| **D8** | Day labels: Day 1 = batch `createdAt` weekday in user's timezone. Day N = Day 1 + (N-1) days. Computed client-side from `createdAt` (sent as UTC ISO string) using `Intl.DateTimeFormat`. No new column; no server-side timezone storage in Phase 3. |
| **D9** | Reminder surface: in-app only. Dashboard banner + TopBar countdown. No emails. |
| **D10** | Plan-management UI: not in Phase 3. `/pricing` page gets accurate plan cards + a "Coming soon" CTA on the Subscribe button. Real upgrade flow is Phase 5. |
| **D11** | Manual plan seeding for dev/QA: a `subscriptionService.setPlan(userId, plan)` admin helper. Not exposed as a server action; called only from a one-off script or directly via Drizzle Studio. Lets us test Starter/Pro flows before payments exist. |
| **D12** | Cancelled-recoverable interaction with quota: a cancelled batch still locks the 7-day window (same rule as trial). The cancelled-recoverable flow from Phase 2 keeps working — users can edit / re-schedule the cancelled batch — but generating a NEW one requires the 7-day clock to elapse OR a plan change. |
| **D13** | `subscriptionService.canGenerate` keeps the discriminated-union return shape. Phase 2's `"trial_batch_exists"` reason stays; Phase 3 adds `"weekly_cap_active"`, `"starter_platforms_overage"`, and `"plan_inactive"`. Each reason carries the minimal extra payload the UI needs to render the right gated screen. |
| **D14** | Existing trial-era subscription rows backfill `plan_changed_at` to `created_at` in migration 0005. Existing batches backfill `post_length` to `NULL` (means "treat as medium at render and prompt time"). |

---

## 2. End-to-end flow this spec enables

### 2.1 Trial user (no change vs Phase 2 happy path)

Sign up → onboarding (3 platforms allowed) → `/create` → Generate (1 batch ever) → wizard → schedule. Trial countdown still shows in TopBar. After day 7: countdown disappears, copy on `/create` gated screen changes from "Your 7-day Pro trial includes one batch" to "Your trial has ended — see plans to keep going", but the existing batch stays editable per Phase 2.

### 2.2 Starter user — happy path

Plan is set manually via DB (or `setPlan` helper) for Phase 3. Profile must have ≤ 2 platforms. On `/create`:
- If no batches yet, OR `lastBatch.createdAt + 7d ≤ now`, OR `lastBatch.createdAt < plan_changed_at` → form renders, Generate proceeds (post-length defaults to "medium", picker hidden).
- Otherwise: gated screen showing "Next batch in N days. Returns Friday."

Wizard works as in Phase 2 but only the 2 chosen platforms get steps.

### 2.3 Pro user — happy path

Plan set manually via DB. Profile can have 1–3 platforms (no cap). On `/create`:
- Same quota gate as Starter (rolling 7-day window).
- Post-length picker visible (short / medium / long), required, no default selection.

Wizard renders all selected platforms' steps (1–3).

### 2.4 Plan change (manual DB)

Operator updates `subscriptions.plan` directly. Service helper `setPlan` exists for parity. Either path bumps `plan_changed_at`. Next `canGenerate` call sees the bumped timestamp and allows a fresh batch immediately.

### 2.5 Cancel / downgrade mid-week

`subscriptions.status` → `"cancelled"` or plan → `"starter"` mid-week. The in-flight batch (`status ∈ {reviewing, scheduling, cancelled}`) is unaffected — wizard still loads, edit still works, scheduling stays committed. `canGenerate` returns `plan_inactive` (cancelled) or honors the new plan's quota/platform rules (downgrade) for any future generation attempt.

---

## 3. Database changes — migration `0005`

### 3.1 `weekly_batches` — add one column

```ts
postLength: text("post_length")  // nullable. Union "short" | "medium" | "long" at the application layer.
```

Backfill: existing rows get `NULL`. The render and prompt sites treat `NULL === "medium"` for legacy compatibility.

### 3.2 `subscriptions` — add one column

```ts
planChangedAt: timestamp("plan_changed_at").notNull().defaultNow()
```

Backfill: existing rows get `plan_changed_at = created_at` via a one-liner UPDATE in the migration SQL (after the ADD COLUMN). This ensures Phase-2-era users don't trigger a spurious "plan changed, fresh batch unlocked" branch on first `canGenerate` call.

### 3.3 Application-level unions

In `src/lib/schema.ts`, add:

```ts
export type PostLength = "short" | "medium" | "long";
```

`SubscriptionPlan`, `SubscriptionStatus`, `Platform`, `SelectionPlatform`, `BatchStatus` etc. are unchanged.

### 3.4 Migration generation

```
npm run db:generate
npm run db:migrate
```

**Never `db:push`** (per AGENTS.md). The generated file should land as `drizzle/0005_*.sql`. Review before applying — the SQL should be: two `ALTER TABLE ... ADD COLUMN`, one `UPDATE subscriptions SET plan_changed_at = created_at WHERE plan_changed_at IS NULL;` (only if Drizzle's default backfill leaves the column NULL on existing rows — verify).

---

## 4. File and folder layout

```
src/
├── lib/
│   ├── pricing.ts                            NEW — typed plan + price constants
│   ├── services/
│   │   ├── subscription-service.ts           MODIFIED — extend canGenerate, add setPlan,
│   │   │                                       nextResetAt, plan-aware checkSubscription
│   │   └── profile-service.ts                MODIFIED — Starter platform-cap enforcement
│   │                                           in saveProfile / updatePlatforms
│   └── ai/
│       └── post-generator.ts                 MODIFIED — accept postLength, fold into prompt
└── app/
    ├── (app)/
    │   ├── (onboarded)/
    │   │   ├── create/
    │   │   │   ├── actions.ts                MODIFIED — read postLength from FormData,
    │   │   │   │                                pass through to generateWeekly
    │   │   │   ├── page.tsx                  MODIFIED — paid-quota gated branch alongside
    │   │   │   │                                existing trial-gated branch
    │   │   │   └── components/
    │   │   │       ├── generate-form.tsx     MODIFIED — Pro-only post-length picker
    │   │   │       └── quota-gated-screen.tsx NEW — paid-user "next batch in N days"
    │   │   └── posts/components/
    │   │       └── day-label.tsx             NEW — "Day N · Wed" computed from createdAt
    │   └── pricing/page.tsx                  MODIFIED — three plan cards, "Coming soon" CTA
    └── components/
        └── dashboard/
            ├── plan-strip.tsx                NEW — replaces TrialStrip for paid users,
            │                                    or extends it (composition TBD at task time)
            └── next-batch-banner.tsx         NEW — dashboard banner

drizzle/0005_<auto-name>.sql                  NEW — migration
```

Existing files NOT modified: `src/lib/services/post-service.ts` (the gate is centralised in subscriptionService — postService just calls `canGenerate`), `src/components/posts/wizard-step.tsx` (day labels render in a new wrapper), `subscriptions` table schema definition only gains one column.

---

## 5. Service-layer API

### 5.1 `subscriptionService.canGenerate` — extend

```ts
export async function canGenerate(userId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: "trial_batch_exists" }
  | { allowed: false; reason: "weekly_cap_active"; nextResetAt: Date }
  | { allowed: false; reason: "starter_platforms_overage"; currentCount: number }
  | { allowed: false; reason: "plan_inactive" }
>
```

Logic, in order:

1. Load subscription. If row missing (defensive), return `plan_inactive`.
2. If `status === "trial"`: existing 1-batch-lifetime check. Returns `trial_batch_exists` if any batch exists.
3. If `status === "cancelled"` or `status === "expired"` AND plan is not `"free_trial"` (i.e. paid plan in cancelled/expired): return `plan_inactive`.
4. If `plan === "starter"`: load profile. If `profile.platforms.length > 2`, return `starter_platforms_overage`.
5. For Starter / Pro on `status === "active"`: load `getMostRecentBatch(userId)`.
   - If none, return `{ allowed: true }`.
   - If `lastBatch.createdAt < subscription.planChangedAt`, return `{ allowed: true }` (fresh batch on plan change).
   - Else: `nextResetAt = lastBatch.createdAt + 7d`. If `now >= nextResetAt`, return `{ allowed: true }`. Else return `weekly_cap_active` with `nextResetAt`.
6. Fallthrough (defensive, unknown plan/status combo): return `plan_inactive`.

### 5.2 `subscriptionService.nextResetAt(userId)` — new

Returns `{ at: Date } | { at: null; reason: "no_batch_yet" | "trial_user" | "inactive" }`. Used by the dashboard banner and TopBar countdown so the UI doesn't have to re-implement the rolling-window math.

### 5.3 `subscriptionService.setPlan(userId, plan)` — new (dev/admin only)

```ts
export async function setPlan(
  userId: string,
  plan: SubscriptionPlan,
): Promise<Subscription>
```

Updates `plan`, `status` (→ `"active"` if plan is `"starter"` or `"pro"`; `"trial"` if `"free_trial"`), and `planChangedAt = now()`. Phase 3 is monthly-only, so `billingCycle` is left untouched (stays NULL or whatever was last written). Phase 5 will set `billingCycle` when real billing flows land. Idempotent — calling with the same plan still bumps `planChangedAt`, which is intentional (lets a dev "reset the week" by calling `setPlan` with the user's current plan).

**Not exposed as a server action in Phase 3.** Called only from a one-off script or via Drizzle Studio's direct SQL.

### 5.4 `profileService.saveProfile` — extend validation

Add a final-step check: if `subscription.plan === "starter"` and `input.platforms.length > 2`, return an error (existing error-shape style — likely `{ ok: false, error: "PLATFORMS_OVERAGE_FOR_PLAN" }` or thrown sentinel, depending on current saveProfile shape). Onboarding form treats this as field-level validation on `platforms`.

`profileService.updatePlatforms` (if it exists separately, or as part of saveProfile) gets the same check.

### 5.5 `postService.generateWeekly` — accept `postLength`

```ts
export async function generateWeekly(
  userId: string,
  input: { theme: string; importantThing: string; postLength: PostLength }
): Promise<GenerateWeeklyResult>
```

`input.postLength` is persisted on the new `weekly_batches.post_length` column AND passed through to `postGenerator.generate({ ..., postLength })`. No other postService changes.

### 5.6 `postGenerator.generate` — fold postLength into prompt

Append a length-directive paragraph to the system prompt. Suggested copy (Wave-level decision, not locked here):
- `"short"` → "Keep each caption to 1–2 sentences. Designed to scroll-stop on mobile."
- `"medium"` → "2–4 sentences. Conversational, enough room for a hook + one supporting line + CTA."
- `"long"` → "5–8 sentences. Storytelling format — open with a hook, build context, land on a CTA."

Exact word counts ship in the actual Anthropic prompt; the spec only locks the three names.

---

## 6. UI requirements

### 6.1 `/create` page (`src/app/(app)/(onboarded)/create/page.tsx`)

Gate branches, in order of evaluation (server-rendered):

1. Trial + has any batch → existing `<TrialGatedScreen />` (unchanged).
2. Paid + `canGenerate` returns `weekly_cap_active` → new `<QuotaGatedScreen nextResetAt={...} />`. Copy: "Your next batch unlocks in N days, on {weekday, e.g. 'Friday'}. ← Return to your current batch" with deep-link to `/posts`.
3. Paid + `canGenerate` returns `starter_platforms_overage` → new copy: "Your Starter plan covers 2 of the 3 platforms you've picked. Update your profile to choose two." → CTA to `/settings`.
4. `plan_inactive` → "Your subscription isn't active. See plans →" → CTA to `/pricing`.
5. Otherwise → `<GenerateForm />` (current behavior).

### 6.2 `<GenerateForm />` — add post-length picker

- If user's plan is `"pro"`: render a required radio group / segmented control: **Short · Medium · Long**. Selection submitted as `postLength` FormData field.
- If user's plan is `"starter"` or `"free_trial"`: picker hidden, `postLength` submitted as `"medium"` via a hidden input.
- Default state on render: no preselection for Pro (forces an explicit choice). The placeholder rule from Phase 2 (theme + importantThing placeholders) is unchanged.

### 6.3 `/posts` wizard — day labels

A new `<DayLabel postOrder={N} batchCreatedAt={...} />` component renders inside each `<WizardStep />` card and each `<WizardSummary />` card. Output: `"Day 1 · Wed"` style. Computed via:

```ts
const dayN = postOrder;                                    // 1..7
const date = addDays(batchCreatedAt, postOrder - 1);
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
return `Day ${dayN} · ${weekday}`;
```

Sits in the existing per-card header row alongside the network icon. Locked-summary cards get the same label.

### 6.4 TopBar — plan pill stays, trial countdown extends

`<DashboardTopBar />` already shows the plan pill (Free trial / Starter / Pro). Phase 3 additions:

- If `subscription.status === "trial"`: existing `<TrialStrip daysLeft={N} />` (unchanged).
- If paid user has `weekly_cap_active`: show a small countdown next to the plan pill: "Next batch · 3d". Tappable → scrolls dashboard to the banner (§ 6.5).
- The placeholder "7 posts ready this week" string in TopBar gets replaced by either the trial countdown OR the quota countdown — same slot, different copy.

### 6.5 Dashboard `<NextBatchBanner />`

Renders on `/dashboard` (and only there) for paid users — always present, contents flip based on `canGenerate`. **Never implies a batch is pre-made**: the user still provides theme + importantThing (+ post-length on Pro) on `/create`. The banner just signals "your 7 days are up, you can create now" vs. "still locked, N days to go".

**Allowed-to-generate state** (`canGenerate.allowed === true` AND the user has at least one prior batch):

> **Your 7 days are up — you can create your next batch.** **[Create this week's posts →]**

**Quota-active state** (`canGenerate.reason === "weekly_cap_active"`):

> **Next batch in {N} days.** Your weekly cycle resets 7 days after your last batch.

No CTA in the quota-active state. Same visual slot — the banner is always there for paid users, the copy flips.

Trial users do NOT see this banner — they see the existing trial-strip + the standard dashboard layout.

### 6.6 `/pricing` page

Three plan cards in a row (sm+) / stacked (mobile):

| Card | Title | Price | Bullet list | CTA |
|---|---|---|---|---|
| 1 | Free trial | $0 · 7 days | "Full Pro features", "1 batch lifetime", "No card required" | Already on trial (disabled) or "Start free trial" (signed-out) |
| 2 | Starter | $9.99/mo | "1 batch / week", "2 of 3 platforms", "All edit + regenerate features" | "Coming soon" (disabled) |
| 3 | Pro | $19.99/mo | "1 batch / week", "All 3 platforms (pick 1–3)", "Pick post length (short / medium / long)" | "Coming soon" (disabled) |

No checkout flow. The "Coming soon" CTAs are inert buttons with a `title` attr "Payments arrive in Phase 5".

### 6.7 Settings — plan section

A new "Plan" section on `/settings` shows:
- Current plan (label + price)
- Status (trial / active / cancelled / expired)
- Next reset (paid plans only) — same `nextResetAt` value used by the banner
- Read-only — no upgrade button in Phase 3

If `starter_platforms_overage`: render an inline error here pointing to the platform selector with copy "Your Starter plan covers 2 platforms — you've picked 3. Choose 2 to keep generating."

### 6.8 Onboarding — platform picker

Existing form (3 checkboxes for FB/IG/LI, min 1). Phase 3 keeps the existing UI for trial users (they get full Pro = 3 platforms allowed). For Starter users opening the onboarding form (rare in Phase 3 since they'd typically be set to Starter via DB *after* onboarding), the form enforces max 2 with field-level error: "Starter covers 2 platforms — uncheck one."

---

## 7. Error handling

### 7.1 New `canGenerate` reasons (D13)

| Reason | When | Surface |
|---|---|---|
| `trial_batch_exists` | Trial user with any batch | `<TrialGatedScreen />` (Phase 2, unchanged) |
| `weekly_cap_active` | Paid user, last batch < 7d ago AND not on a new plan | `<QuotaGatedScreen />` (new) |
| `starter_platforms_overage` | Starter user with > 2 `profile.platforms` | `<QuotaGatedScreen />` variant with settings CTA |
| `plan_inactive` | Paid plan with `status ∈ {cancelled, expired}` | Pricing-page redirect copy |

### 7.2 `generateWeekly` error map (unchanged from Phase 2)

`no_profile`, `ai_failed`, `db_failed`, plus the `canGenerate` reasons forwarded verbatim. No new error variants — Phase 3 routes through the existing union by adding values to `GenerateWeeklyResult["error"]`.

### 7.3 Race conditions

- Plan change during a generate: `canGenerate` is called inside `generateWeekly` immediately before the transaction. The race window is sub-second. If plan flips to inactive AFTER the gate but BEFORE the INSERT, the batch persists — acceptable, this is a near-impossible race with no safety impact.
- Two parallel generate calls: existing Phase 2 behavior (DB transaction). The 7-day window check is read-only and idempotent under concurrency.

---

## 8. What this spec deliberately does NOT cover

- **Polar / Stripe integration.** All payment plumbing.
- **Plan upgrade/downgrade UI.** "Coming soon" only.
- **Image generation, regenerations, "Use my face".** Image phase.
- **2x/day posting cadence.** Phase 4 scheduling.
- **Smart trial conversion screen.** Image phase.
- **Email reminders.** Phase 4 notification surface.
- **Annual plans.** Phase 3 is monthly-only. Annual pricing + the monthly-vs-yearly toggle on `/pricing` arrive with real payments in Phase 5.
- **Multi-business / team plans.** Not in Phase 3.
- **Multi-theme / monthly theme rotation.** Theme input stays single-weekly as built in Phase 2 (one `theme` string per batch). Phase 4 owns any monthly / multi-theme work.
- **Trial-abuse hardening** (multi-account / disposable emails). Tracked in `specs/phase-3-backlog.md`; defer until before public launch.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Trial users from Phase 2 hit Phase 3 with no `plan_changed_at` and the gate returns `plan_inactive` | Migration backfill sets `plan_changed_at = created_at` for all existing rows; `checkSubscription` falls back gracefully |
| Operator manually sets `plan = "starter"` on a user with 3 platforms | Gate blocks with `starter_platforms_overage`; UI directs to settings; data integrity preserved |
| Pro user picks "long" → Claude returns over-long copy → wizard rendering breaks | Existing wizard already handles arbitrary-length captions (`break-words` + scroll). No layout risk. |
| Time zone drift on day labels (server UTC vs user local) | Computed client-side using `Intl.DateTimeFormat(undefined, ...)` — browser timezone is the source of truth. Edge case: SSR mismatch flash. Mitigation: render the label inside a client component, accept a one-frame flash. |
| Two browser tabs both pass the gate, both call generate, both succeed → user spends 2 AI calls for one slot | Existing Phase 2 cancelled-recoverable flow + the 7-day rolling check make this self-correcting (the second batch sets the new reset clock; the first is still there). Trivial cost; not worth a distributed lock. |
| Existing TrialStrip slot in TopBar conflicts with new countdown | Composition in `<DashboardTopBar />`: trial countdown OR quota countdown OR nothing — never both. Single rendering branch keyed on `subscription.status`. |

---

## 10. Definition of done

- [ ] Migration `0005` generated via `npm run db:generate`, reviewed, applied via `npm run db:migrate`. Never `db:push`.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` all exit 0.
- [ ] `subscriptionService.canGenerate` returns the 4-reason union per D13; all 4 reasons round-trip through `generateWeekly`.
- [ ] `subscriptionService.nextResetAt` returns correct values for: no-batch-yet, recent-batch (within 7d), expired-batch (>7d), trial user, inactive plan.
- [ ] `subscriptionService.setPlan` updates `plan`, `status`, `planChangedAt` atomically. Verified via Drizzle Studio. (`billingCycle` left untouched in Phase 3.)
- [ ] `profileService.saveProfile` rejects > 2 platforms when plan is `"starter"`.
- [ ] `/create` form mode: post-length picker visible for Pro, hidden for Starter/Trial (submitted as "medium").
- [ ] `/create` gated branches render correctly for: trial+has-batch, paid+weekly-cap-active, starter+platforms-overage, plan-inactive.
- [ ] `<DayLabel />` renders "Day N · Weekday" in user's browser timezone on wizard step, summary, and locked-summary cards.
- [ ] `<NextBatchBanner />` shows on `/dashboard` for paid users only, flips copy based on `canGenerate` state. Copy never implies a batch is pre-made — user always provides theme + importantThing on `/create`.
- [ ] TopBar countdown extends to paid users (`Next batch · Nd`) when in `weekly_cap_active`.
- [ ] `/pricing` page renders 3 plan cards; all CTAs disabled with "Coming soon" titles.
- [ ] `/settings` plan section renders current plan + status + nextResetAt.
- [ ] Manual QA: walk a Starter user (set via Drizzle Studio) through generate → wait 1 minute → confirm gate blocks → bump `plan_changed_at` → confirm gate opens. Document in the audit task's manual-test log.
- [ ] Manual QA: confirm 3-platform Starter user sees `starter_platforms_overage` on `/create`. Update profile to 2 platforms → gate unblocks.
- [ ] Manual QA: cancel a paid subscription via Drizzle Studio → in-flight batch still loads and is editable, `/create` shows pricing redirect.
- [ ] Security audit: `setPlan` is NOT exported as a server action (grep `actions.ts` for any import of `setPlan` → expect zero).
- [ ] All boxes above ticked in PR description.

---

## 11. After sign-off

Split into tasks (planned, not yet created — confirm spec first):

1. **task-01-schema-migration** — migration 0005 (two columns + backfill).
2. **task-02-pricing-constants** — `src/lib/pricing.ts`.
3. **task-03-subscription-service** — extend `canGenerate`, add `nextResetAt`, `setPlan`.
4. **task-04-profile-service** — Starter platform-cap enforcement.
5. **task-05-post-generator-length** — `postLength` prompt fold.
6. **task-06-post-service-pass-through** — `generateWeekly` accepts `postLength`.
7. **task-07-create-gate-branches** — `/create` page + `<QuotaGatedScreen />`.
8. **task-08-create-form-length-picker** — Pro-only post-length picker.
9. **task-09-day-labels** — `<DayLabel />` + render sites.
10. **task-10-dashboard-banner** — `<NextBatchBanner />`.
11. **task-11-topbar-countdown** — extend TopBar / TrialStrip composition.
12. **task-12-pricing-page** — 3 plan cards, "Coming soon" CTAs.
13. **task-13-settings-plan-section** — plan + status + reset time.
14. **task-14-onboarding-platforms-cap** — Starter 2-platform enforcement in form UI.
15. **task-15-security-and-typecheck** — same shape as Phase 2 task-14.

Suggested waves (parallelism map):

| Wave | Tasks |
|---|---|
| 1 | 01 (schema), 02 (pricing constants) |
| 2 | 03, 04, 05, 06 (service layer, all parallel) |
| 3 | 07, 08, 09, 10, 11, 12, 13, 14 (UI, all parallel) |
| 4 | 15 (audit) |
