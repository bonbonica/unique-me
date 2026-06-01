# Phase 4 Section A — Pro Monthly Quota

## 0. Status of items flagged this revision

### Resolved (locked into the spec body)

- Pro allowance changes from **1 batch / rolling 7 days** to **4 batches / rolling 30 days**. Trial and Starter behavior is **unchanged**.
- Pro period anchor is the user's billing/subscription start date, stored as `subscriptions.period_start_date`. Rolling 30 days from that anchor — no calendar / leap-year math.
- Pro has **no 7-day wait between batches**. A Pro user may consume all 4 batches whenever within the period, including same-day. Trial/Starter keep their 7-day wait.
- Within a Pro period, batch sizes are **fixed: 7 / 7 / 7 / 9 posts**. Batches 1–3 cover 7 days each; batch 4 covers the remaining 9 days. Always 30 posts per period.
- The user does **not** pick batch length. It is derived from the batch's ordinal position in the period.
- Unused batches **do not carry over** at rollover.
- `regenerate` becomes batch-length-aware in Phase 4 (closes a pre-existing Phase 3 follow-up; required for 9-post batches not to corrupt).
- `monthly_cap_active` is added as a new `canGenerate` reason code (distinct from `weekly_cap_active`).
- 30-day rollover is computed **in pure JS** — no write on read. `periodStartDate` is the immutable anchor.
- Test infrastructure (Vitest) is introduced in this phase — it is a prerequisite for the spec's parity test, not a verification step.

### Items deliberately deferred (named so they don't sneak in)

- **Section B — Themed sequential batches.** The themed/sequential creation flow depends on scheduling and background-job infrastructure that does not exist yet. Specced separately in `specs/phase-4-pro-monthly-quota-spec.md` (Section B). Build after Section A ships.
- **Real payment / billing integration.** Still Phase 5. `periodStartDate` is set manually via Drizzle Studio or via `setPlan` during Phase 4.
- **Removal of `postsUsedThisMonth` / `regenerationsDuringTrial`.** These columns are dead machinery; the open question of removal is deferred (no cleanup task in Phase 4).
- **Multi-theme / annual plans / upgrade UI.** Still Phase 5.

---

## 1. Decisions locked

| # | Decision |
|---|---|
| **D-A1** | Pro allowance = **4 batches per 30-day period**. Rolling, not calendar. |
| **D-A2** | The period **starts on the user's billing/subscription start date** (`subscriptions.period_start_date`) and resets every 30 days from that anchor. |
| **D-A3** | A Pro user may use all 4 batches **whenever they want** within the period — **no 7-day wait between batches**. All 4 on day 1 is allowed. This is the core behavioral change vs. Phase 3. |
| **D-A4** | Unused batches **do not carry over**. At each 30-day reset the allowance returns to 4. |
| **D-A4a** | **A batch = 1 post per day** for the days it covers. |
| **D-A4b** | **Batch sizes within a Pro period are fixed: 7 / 7 / 7 / 9 posts.** Batches 1–3 cover 7 days each (7 posts); batch 4 covers the remaining 9 days (9 posts). Total = 30 posts. Because the period is a fixed 30 days, the leftover is always 2 days, so the last batch is always 9 posts. |
| **D-A4c** | The batch's **ordinal position in the current period** (1st, 2nd, 3rd, or 4th) determines its post count. Computed server-side at generate time: `ordinal = (Pro batches already created in current period) + 1`. |
| **D-A5** | **Starter is unchanged**: 1 batch per rolling 7 days, 7-post batches. |
| **D-A6** | **Trial is unchanged**: 1 batch lifetime, 7-day trial, 7-post batches. |
| **D-A7** | New column `subscriptions.period_start_date` (timestamp, not null, default `now()`). Unused for trial/Starter rows. Backfilled to `plan_changed_at` for existing rows in migration `0006`. |
| **D-A8** | **Quota stays derived** — count `weekly_batches` rows since the current period start. Do not reuse `postsUsedThisMonth` (dead machinery). A stored counter risks drifting from real batch rows. |
| **D-A9** | New column `weekly_batches.batch_ordinal_in_period` (integer, nullable). Stored at insert time. Non-Pro batches get NULL. |
| **D-A10** | `canGenerate` branch 5 is split by plan. **Starter** → existing rolling-7-day, 1-batch logic, unchanged. **Pro** → count batches in `weekly_batches` with `created_at >= max(currentPeriodStart, planChangedAt)`. If `count < 4` → allowed. If `count >= 4` → `monthly_cap_active` with the next reset date. |
| **D-A11** | **30-day rollover computed in pure JS, never persisted on read.** The current period's start = `floor((now - periodStartDate) / 30d) * 30d + periodStartDate`. Zero writes on hot paths, no race under concurrent calls. |
| **D-A12** | **New reason code `monthly_cap_active`** added to the `canGenerate` discriminated union. Distinct from `weekly_cap_active` so gate-screen and banner copy can differ cleanly. Payload: `{ nextResetAt: Date; batchesUsed: number }`. |
| **D-A13** | `planChangedAt` interaction preserved. For Pro, batches created before `planChangedAt` do not count toward the 4. Strict `<` comparison stays — same-instant writes fail closed. |
| **D-A14** | `canGenerate` and `nextResetAt` must be updated together. For at-cap Pro: `nextResetAt = currentPeriodStart + 30d`. For under-cap Pro: `{ at: null, reason: "no_batch_yet" }` (parallel to Starter under-cap). |
| **D-A15** | Parity tests must assert `canGenerate` and `nextResetAt` agree across at-cap, under-cap, rollover boundary, and plan-change-reset. Vitest is introduced in this phase for this purpose. |
| **D-A15a** | Two batch lengths exist: **7-post** (the existing batch, unchanged) and **9-post** (new). |
| **D-A15b** | **Fixed order, not user choice:** within a Pro period, batches 1, 2, and 3 are 7-post; batch 4 is automatically 9-post. The user does not pick. |
| **D-A15c** | The create flow / `postService` passes the resulting post count (7 or 9) into `post-generator.ts`. The generator just makes N daily posts as it already does, with N parameterised. |
| **D-A15d** | **The Pro difference is the wait, not the batch:** trial/Starter must wait the rolling 7 days. Pro can create the next batch immediately, up to 4 in the period. |
| **D-A15e** | `weekly_batches.totalPosts` (already exists, defaults 7) is set to 7 or 9 at insert. `batchOrdinalInPeriod` is stored alongside so post-hoc summary rendering knows the ordinal without re-computing. |
| **D-A15f** | Starter and trial are unchanged — 7-post batches, 7-day wait. The 9-post batch and no-wait behavior are Pro-only. |
| **D-A16** | **Cancelled batches count toward the Pro 4-per-period cap**, same rule as Phase 3 D12 for Starter. One conceptual rule for the whole codebase. |
| **D-A17** | **`regenerate` becomes batch-length-aware in Phase 4.** It reads `batch.totalPosts` from the row and passes that into `regenerateOne` as `postCount`. Closes the Phase 3 task-06 deferred follow-up. With 9-post batches existing, this is no longer cosmetic. |
| **D-A18** | `setPlan` extension: when transitioning to Pro from a non-Pro plan, set `period_start_date = now()` in addition to bumping `planChangedAt`. Off-Pro transitions leave the column alone. |
| **D-A19** | `SubscriptionStateSnapshot` gains `proQuota: { used: number; max: 4; periodEndsAt: Date } | null` (null for non-Pro). Computed in the same internal helper used by `canGenerate` and `nextResetAt` — no extra DB round-trip on the UI hot path. |

---

## 2. End-to-end flow this spec enables

### 2.1 Trial user — unchanged from Phase 3

Sign up → onboarding → `/create` → Generate (1 batch lifetime) → wizard → schedule. Pro 30-day quota, 9-post batches, no-wait behavior do not affect trial.

### 2.2 Starter user — unchanged from Phase 3

Rolling 7-day wait, 1 batch per cycle, 7-post batches, 2-of-3 platforms. Phase 4 does not touch this surface area beyond the branch split in `canGenerate`.

### 2.3 Pro user — Phase 4 happy path

Plan set manually via DB or `setPlan`. `subscriptions.period_start_date` set to subscription start (or `now()` on upgrade). On `/create`:

- Batch 1 (ordinal 1) → 7 posts. Immediately after generation, **no wait** — gate stays open.
- Batch 2 (ordinal 2) → 7 posts. Same day if desired. Still open.
- Batch 3 (ordinal 3) → 7 posts. Still open.
- Batch 4 (ordinal 4) → **9 posts** (auto, no user choice).
- Attempt batch 5 → gate blocks with `monthly_cap_active`. Banner / TopBar / settings show "next reset on {date}".

At `now >= periodStartDate + 30d`: the current period's start advances 30 days (computed in JS), batch counter effectively resets to 0, allowance returns to 4. Anchor (`period_start_date` row) is NOT written on read.

### 2.4 Pro plan-change mid-period

`setPlan(userId, "pro")` on a non-Pro row sets `period_start_date = now()` and bumps `planChangedAt`. Fresh 4-batch allowance starts at that instant. Pre-Pro batches do not count.

### 2.5 Downgrade Pro → Starter mid-period

`subscriptions.plan` flips to `"starter"` via DB or `setPlan`. In-flight batch preserved (Phase 3 rule). Future gating uses Starter's 7-day rule. `period_start_date` left intact (harmless; Starter doesn't read it).

### 2.6 Regenerate on a 9-post batch

User opens batch 4 (9-post), edits post #8, hits regenerate. `postService.regenerate` reads `batch.totalPosts = 9`, passes `postCount: 9` into `regenerateOne`. AI returns valid output for the 9-post context. Without this change (D-A17), the regenerate would silently break under 9-post batches.

---

## 3. Database changes — migration `0006`

### 3.1 `subscriptions` — add one column

```ts
periodStartDate: timestamp("period_start_date").notNull().defaultNow()
```

Backfill: `UPDATE "subscriptions" SET "period_start_date" = "plan_changed_at";` so existing rows get a sensible anchor (most users will be trial/Starter where this column is unused, but Pro rows get the plan-change time as their first period start).

### 3.2 `weekly_batches` — add one column

```ts
batchOrdinalInPeriod: integer("batch_ordinal_in_period")  // nullable
```

Existing rows get NULL. Trial / Starter batches always remain NULL. Pro batches store 1, 2, 3, or 4.

### 3.3 Migration generation

```
pnpm db:generate
pnpm db:migrate
```

**Never `db:push`** (per AGENTS.md). The generated file should land as `drizzle/0006_*.sql`. Review before applying — the SQL should be: two `ALTER TABLE ... ADD COLUMN`, one `UPDATE subscriptions SET period_start_date = plan_changed_at;`.

---

## 4. File and folder layout

```
src/
├── lib/
│   ├── pricing.ts                              MODIFIED — Pro pitch/features copy,
│   │                                             new constants (MAX_BATCHES_PER_PERIOD,
│   │                                             ROLLING_PERIOD_DAYS, PRO_LONG_BATCH_POSTS)
│   ├── schema.ts                                MODIFIED — two new columns
│   ├── services/
│   │   ├── subscription-service.ts              MODIFIED — Pro branch in canGenerate +
│   │   │                                          nextResetAt; setPlan extension; snapshot
│   │   │                                          gains proQuota field
│   │   ├── post-service.ts                      MODIFIED — generateWeekly + regenerate
│   │   │                                          length pass-through; persist ordinal
│   │   └── __tests__/
│   │       └── subscription-service.test.ts     NEW — Vitest parity + rollover suite
│   └── ai/
│       └── post-generator.ts                    MODIFIED — postCount parameter
└── app/
    ├── (app)/
    │   └── (onboarded)/
    │       ├── create/
    │       │   ├── actions.ts                   MODIFIED — compute ordinal + postCount
    │       │   │                                  server-side, pass into generateWeekly
    │       │   └── page.tsx                     MODIFIED — handle monthly_cap_active reason
    │       ├── dashboard/page.tsx               MODIFIED — pass proQuota to banner
    │       └── settings/page.tsx                MODIFIED — pass proQuota to plan section
    └── pricing/page.tsx                         MODIFIED — Pro card copy verification

src/components/
├── create/
│   └── quota-gated-screen.tsx                   MODIFIED — add monthly_quota variant
├── dashboard/
│   ├── next-batch-banner.tsx                    MODIFIED — Pro variant copy
│   ├── quota-countdown-pill.tsx                 MODIFIED — Pro batches-left rendering
│   └── top-bar.tsx                              MODIFIED — pass new props to pill
├── posts/
│   ├── wizard-step.tsx                          MODIFIED (if needed) — iterate totalPosts
│   ├── wizard-summary.tsx                       MODIFIED (if needed) — iterate totalPosts
│   ├── locked-summary.tsx                       MODIFIED (if needed) — iterate totalPosts
│   └── day-label.tsx                            potentially unchanged — confirm at task time
└── settings/
    └── plan-section.tsx                         MODIFIED — Pro period usage line

drizzle/0006_<auto-name>.sql                     NEW — migration

specs/phase-4-pro-monthly-quota/
└── verification.md                              NEW — manual E2E steps (task 20)

vitest.config.ts                                 NEW — test runner config
```

---

## 5. Service-layer API

### 5.1 `subscriptionService.canGenerate` — split branch 5

```ts
export async function canGenerate(userId: string): Promise<
  | { allowed: true }
  | { allowed: false; reason: "trial_batch_exists" }
  | { allowed: false; reason: "weekly_cap_active"; nextResetAt: Date }
  | { allowed: false; reason: "monthly_cap_active"; nextResetAt: Date; batchesUsed: number }
  | { allowed: false; reason: "starter_platforms_overage"; currentCount: number }
  | { allowed: false; reason: "plan_inactive" }
>
```

Logic, in order (only branch 5 changes from Phase 3):

1. Load subscription. If row missing (defensive), return `plan_inactive`.
2. If `status === "trial"`: existing 1-batch-lifetime check. Returns `trial_batch_exists` if any batch exists.
3. If `status ∈ {"cancelled", "expired"}` AND plan is not `"free_trial"`: return `plan_inactive`.
4. If `plan === "starter"` and `profile.platforms.length > 2`: return `starter_platforms_overage`.
5. **Active paid (split by plan):**
   - **Starter** → existing rolling-7-day, 1-batch logic. Unchanged.
   - **Pro** →
     - Compute `currentPeriodStart` from `periodStartDate` via D-A11 formula (pure JS, no write).
     - Count `weekly_batches` rows where `userId = $1 AND created_at >= max(currentPeriodStart, planChangedAt)`. Status not filtered (D-A16).
     - If `count < 4` → `{ allowed: true }`.
     - Else → `{ allowed: false, reason: "monthly_cap_active", nextResetAt: currentPeriodStart + 30d, batchesUsed: count }`.
6. Fallthrough → `plan_inactive`.

### 5.2 `subscriptionService.nextResetAt` — add Pro branch

Existing return shape unchanged: `{ at: Date } | { at: null; reason: "no_batch_yet" | "trial_user" | "inactive" }`.

For Pro:
- At-cap (`count >= 4`) → `{ at: currentPeriodStart + 30d }`.
- Under-cap → `{ at: null, reason: "no_batch_yet" }` (parallel to Starter under-cap; tells UI "no countdown to show").

### 5.3 `subscriptionService.setPlan` — extend

When `plan === "pro"` and the existing row's plan is NOT `"pro"`, set `period_start_date = now()` alongside the existing `plan_changed_at = now()` bump. Off-Pro transitions leave `period_start_date` alone (harmless; non-Pro plans don't read it).

### 5.4 `SubscriptionStateSnapshot` — add `proQuota`

```ts
export type SubscriptionStateSnapshot = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  isActive: boolean;
  daysLeftInTrial: number | null;
  nextResetAt: Date | null;
  proQuota: { used: number; max: 4; periodEndsAt: Date } | null;
};
```

`proQuota` is non-null only when `plan === "pro" && status === "active"`. Computed by the same internal helper that drives `canGenerate`'s Pro branch — no extra DB round-trip.

### 5.5 `postService.generateWeekly` — accept post count + ordinal

```ts
export async function generateWeekly(
  userId: string,
  input: {
    theme: string;
    importantThing: string;
    postLength: PostLength;
    postCount: 7 | 9;
    batchOrdinalInPeriod: number | null;
  },
): Promise<GenerateWeeklyResult>
```

`postCount` and `batchOrdinalInPeriod` are computed by the caller (server-side in `create/actions.ts`). The service persists `totalPosts: postCount` and `batchOrdinalInPeriod` on the inserted row and forwards `postCount` to `post-generator.ts`. Existing `postLength` plumbing is untouched.

### 5.6 `postService.regenerate` — read length from batch row (D-A17)

`regenerate` reads `batch.totalPosts` from the existing row and passes it into `regenerateOne` as `postCount`. No change to the public signature.

### 5.7 `postGenerator.generate` / `regenerateOne` — accept `postCount`

```ts
export async function generate(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
  postLength?: PostLength;
  postCount: 7 | 9;
}): Promise<Generated | null>

export async function regenerateOne(args: {
  ...
  postCount: 7 | 9;
}): Promise<RegeneratedOne | null>
```

Inside the generator:
- Tool schema's `minItems` and `maxItems` use `args.postCount` instead of literal 7.
- Zod result schema uses `.length(args.postCount)` instead of `.length(7)`.
- Prompt text mentioning "7 posts" becomes "N posts" with the parameter interpolated.

---

## 6. UI requirements

### 6.1 `/create` page — handle `monthly_cap_active`

Existing switch in `src/app/(app)/(onboarded)/create/page.tsx` gains a case for `monthly_cap_active`:

```ts
case "monthly_cap_active":
  return <QuotaGatedScreen variant="monthly_quota" nextResetAt={gate.nextResetAt} batchesUsed={gate.batchesUsed} />;
```

### 6.2 `<QuotaGatedScreen variant="monthly_quota" />`

New variant on the existing discriminated-union component (Phase 3 task-07).

Copy:
> **You've used all 4 batches this period.**
> Your monthly cycle resets on {Weekday, Date} — in {N} days.
> [Return to your current batch →] — deep-link to `/posts`.

Compute the weekday + days-remaining client-side via `Intl.DateTimeFormat` from `nextResetAt`. Same SSR-flash tolerance as Phase 3 § 9.

### 6.3 `<QuotaCountdownPill />` — plan-aware

Add plan + `batchesRemaining` + `periodEndsAt` props (or a discriminated union prop).

- **Pro, under-cap** → "{N} batches left"
- **Pro, at-cap** → "Resets in {N}d"
- **Starter** → existing "Next batch · {N}d" (unchanged)

Preserve the existing `useSyncExternalStore` hydration sentinel.

### 6.4 `<NextBatchBanner />` — Pro variant

`state` name stays `"quota_active"`. Add Pro-specific copy branching internally:

- Pro under-cap (more than 0 batches used in period) → "{used} of 4 batches used · Next reset in {N} days." No CTA.
- Pro at-cap (used === 4) → same shape; CTA omitted.
- Pro 0 used → existing "allowed" copy stays (banner already handles the allowed case).
- Starter / Trial → existing copy, unchanged.

### 6.5 `<PlanSection />` (settings) — Pro period usage

For Pro active users, add a line under the existing plan/status display:

> {used} of 4 batches used this period · Resets {Weekday, Date}

Reads `snapshot.proQuota`. Trial / Starter sections unchanged.

### 6.6 `/pricing` page — Pro card copy

`PLAN_DETAILS.pro.pitch` changes from `"1 batch per week, all platforms"` to `"4 batches per month, all platforms"`. `PLAN_DETAILS.pro.features[0]` changes from `"1 batch / week"` to `"4 batches / month"`. Starter and free_trial copy untouched.

### 6.7 Day labels / locked summary — 9-day batches

Wherever per-post iteration happens in `src/components/posts/*.tsx`, confirm the iteration is driven by `batch.totalPosts`, not a literal `7`. Likely a 1–2 line fix per surface. Day labels (`<DayLabel />`) take `postOrder` already and should already work — verify at task time.

---

## 7. Error handling

### 7.1 New `canGenerate` reason

| Reason | When | Surface |
|---|---|---|
| `monthly_cap_active` | Pro user, 4 batches in current period since `max(periodStart, planChangedAt)` | `<QuotaGatedScreen variant="monthly_quota" />` + Pro banner + Pro topbar pill |

All existing reasons (`trial_batch_exists`, `weekly_cap_active`, `starter_platforms_overage`, `plan_inactive`) keep their Phase 3 semantics.

### 7.2 Race conditions

- Two parallel Pro generates: the count query in `canGenerate` is read-only; race window between gate and insert is sub-second. Worst case is one over-grant per concurrent burst (matches Phase 2/3 tolerance). No distributed lock — not worth the operational cost.
- Period rollover during a generate: rollover is computed in JS from a stable anchor (`periodStartDate`). Two requests that straddle the rollover boundary will both see the new period — fine.

---

## 8. What this spec deliberately does NOT cover

- **Section B — themed sequential batches.** Specced in `specs/phase-4-pro-monthly-quota-spec.md` (Section B); requires not-yet-built scheduling infrastructure.
- **Real payments / Polar / Stripe.** Phase 5.
- **Plan upgrade UI.** Phase 5. Pro is reached via `setPlan` in Drizzle Studio during Phase 4.
- **Multi-theme batches, annual plans, multi-business.** Phase 5+.
- **Removing `postsUsedThisMonth`.** Out of scope; column stays as dead machinery.
- **Email reminders / notifications.** Phase 4 scheduling work.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| `post-generator.ts` enforces 7 in TWO places (Zod `.length(7)` and tool schema `minItems/maxItems: 7`) | Task 09 parameterises both. Without that, batch 4 silently breaks at generate time. |
| `regenerate` is currently length-blind (Phase 3 deferred follow-up) | Task 11 closes it. Without this, regenerating a 9-post batch produces an invalid AI response. |
| Test infrastructure does not exist | Task 03 introduces Vitest in Wave 1. Required for task 08 parity test. |
| `setPlan` to Pro forgets to set `period_start_date` | Task 07 explicit. Without this, "upgrade mid-period = fresh allowance" edge case is wrong. |
| Period rollover persisted on read | Avoided by D-A11. Pure JS, no DB writes on hot paths. |
| `canGenerate` and `nextResetAt` drift | Task 08 parity test enforces agreement. Tasks 04 and 05 must be reviewed together. |
| UI surfaces silently render 7-day copy for Pro at-cap | Task 13 introduces a new gate-screen variant; TypeScript's exhaustiveness check surfaces missed switch arms. |
| Pricing card pitch text outdated | Task 02 updates `PLAN_DETAILS.pro.pitch` and `features[0]`; task 17 verifies the rendered page picks them up. |

---

## 10. Definition of done

- [ ] Migration `0006` generated via `pnpm db:generate`, reviewed, applied via `pnpm db:migrate`. Never `db:push`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` all exit 0.
- [ ] `pnpm test` runs the Vitest suite from tasks 03 + 08; all green.
- [ ] `subscriptionService.canGenerate` returns each of the 5 reason variants (or `allowed: true`) correctly; `monthly_cap_active` reachable via Pro at-cap state.
- [ ] `subscriptionService.nextResetAt` returns the matching value for Pro at-cap (= `currentPeriodStart + 30d`) and under-cap (= `{ at: null, reason: "no_batch_yet" }`).
- [ ] `setPlan(userId, "pro")` from a non-Pro state sets `period_start_date = now()` AND bumps `plan_changed_at`. Verified via Drizzle Studio.
- [ ] Pro user can create 4 batches back-to-back with no wait. Batch 4 has 9 posts. 5th attempt blocks with `monthly_cap_active`.
- [ ] `<QuotaGatedScreen variant="monthly_quota" />` renders correct copy + next-reset date.
- [ ] `<QuotaCountdownPill />` Pro variant shows "{N} batches left" under-cap, "Resets in Nd" at-cap.
- [ ] `<NextBatchBanner />` Pro variant shows "{used} of 4 batches used".
- [ ] `<PlanSection />` Pro variant shows "{used} of 4 used · Resets {date}".
- [ ] `/pricing` Pro card shows "4 batches / month" feature copy + updated pitch.
- [ ] `regenerate` on a 9-post batch produces a valid result (length-aware per D-A17).
- [ ] Manual QA: edit `period_start_date` to a past date via Drizzle Studio → counter effectively resets, generation re-opens.
- [ ] Manual QA: downgrade Pro → Starter mid-period → in-flight batch still loads + edits; gate flips to Starter 7-day rule.
- [ ] Security audit: `grep -r "setPlan" src/app/` returns zero.
- [ ] Security audit: `grep -r "periodStartDate" src/app/` returns only read access (no mutations).
- [ ] All boxes above ticked in PR description.

---

## 11. After sign-off

20 tasks across 5 waves. **Wave 2 tasks (04–08) all edit `src/lib/services/subscription-service.ts` and must run sequentially, not in parallel.** Other waves' parallelism is per the wave table.

| Wave | Tasks | Parallelism |
|---|---|---|
| 1 | 01 (schema), 02 (pricing constants), 03 (Vitest infra) | parallel within wave |
| 2 | 04, 05, 06, 07, 08 | **sequential — same file** |
| 3 | 09 (generator), 10 (postService generate), 11 (postService regenerate), 12 (create route) | 10 + 11 + 12 parallel after 09 |
| 4 | 13 (gate screen), 14 (topbar pill), 15 (banner), 16 (settings), 17 (pricing card), 18 (day labels) | parallel within wave |
| 5 | 19 (audit), 20 (E2E verification) | sequential |
