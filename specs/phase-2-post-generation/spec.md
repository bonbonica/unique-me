# Phase 2 — Post Generation

**Status:** Revision 3. Awaiting your review of § 0 (small remaining items) before task split. No code yet.

**Scope:** `/create` becomes a real flow (with gated mode for trial users who've already used their batch); `/posts` becomes a **multi-step wizard** that walks the user network-by-network through reviewing the 7 posts (with edit + regenerate, 1× cap), ending in a summary screen where they explicitly opt in each post-network combination, then commit via a single "Schedule my pick" action. Plus a `/onboarding` modification: capture which networks the user wants (Facebook, Instagram, LinkedIn).

**Out of scope (deferred):**
- Image generation (Phase 3).
- Active subscription / credit gating beyond the trial-1-batch cap (Phase 3+).
- Per-platform image resize/crop at publish time (Phase 4 `postingService`).
- Scheduling calendar / OAuth / cron / auto-post (Phase 4).
- **Individual post unschedule/reschedule once committed** — covered in § 11. Real-world emergencies (town events, breaking news) need this, but it's Phase 4.

**Source documents:**
- `UniqueMe pdf/Service_Layer_Commands_UniqueMe.pdf`
- `UniqueMe pdf/UniqueMe_App_Vision_and_Architecture.pdf`
- `UniqueMe pdf/Scheduling_and_Auto_Posting_UniqueMe.pdf`
- `UniqueMe pdf/Payment_Integration_Commands_UniqueMe.pdf` (trial-batch behavior)
- `DESIGN.md`
- `src/lib/ai/website-analyzer.ts`

---

## 0. Status of prior open questions + items flagged this revision

### Resolved (locked into the spec body)

| Item | Resolution |
|---|---|
| **OQ1** (per-network bulk button — discard or keep other selections?) | **N/A** — bulk buttons removed entirely. Replaced by wizard. |
| **OQ2** (does "Schedule this post" lock whole batch?) | **N/A** — per-card schedule button removed. Wizard commits everything at the summary step. |
| **R7** Selection storage | Accepted — `post_selections` sibling table. |
| **R8** Default aspect ratios for previews | Accepted — Facebook 1:1, Instagram 1:1, LinkedIn 1.91:1. |
| **R9** Trial banner placement | Accepted — both top-bar strip AND `/create` page note. |
| **§ 8.2.E** Edit-then-stale variations | Accepted **(a) stay stale**, with inline note on each wizard step. |

### Genuinely new this revision (one minor confirmation needed)

| # | Item | My proposal | Need your call? |
|---|---|---|---|
| **R10** | UI shape for `batch.status === "scheduling"` and `"cancelled"` — collapse to a read-only summary view, or let the wizard remain navigable in read-only? | **Collapse to read-only summary.** Less code, simpler mental model, the wizard's whole point is the editable flow. | Confirm or push back. |
| **R11** | Onboarding network picker shape (assumes the existing onboarding form doesn't already ask). | Multi-select **toggle group** (3 chips: Facebook / Instagram / LinkedIn). Required field, at least 1 must be selected. Defaults to none — user must opt in explicitly. | Confirm or override. |
| **R12** | Copy for the stale-variation inline note on non-canonical wizard steps after Edit. | *"You edited this post on the Facebook step — the Instagram/LinkedIn version may be older. Regenerate this post (1 left) to refresh both."* (text adapts to which network the user is currently on; only renders when canonical post `status === "edited"` AND the variation `createdAt < posts.updatedAt`). | Confirm or rewrite. |

If R10–R12 are fine, this spec is ready to split into tasks. Strike them through if not.

### Future enhancement noted, not implemented

- **Per-network post-count questions** in onboarding ("How many Facebook posts per week? Instagram? LinkedIn?"). Phase 2 always generates 7 canonical posts. Flagged in § 8.5.

---

## 1. Decisions locked

D1–D17 carried forward. D18–D20 are new this round. D13 is rewritten to reflect the wizard model.

| # | Decision | Source |
|---|---|---|
| D1 | Two weekly questions (theme + important thing). No mainBusiness, no sourceUrl. | User |
| D2 | Seven canonical Facebook posts generated in one Anthropic API call, never-throws + forced-tool-use + Zod-revalidate. | User + PDF |
| D3 | Canonical Facebook caption on `posts.postText`. Per-post Instagram + LinkedIn text variations on `post_variations`. | User |
| D4 | Variations always generated in Phase 2. Wizard hides those for networks the user didn't pick in onboarding — wasted tokens accepted for simplicity. | User + this revision |
| D5 | Per-post text regeneration with `posts.feedback` + `posts.regeneration_count`. | User |
| D6 | No active subscription / credit gating in Phase 2 EXCEPT the trial-1-batch cap (D20). All other gates are TODOs. | User (refined this revision) |
| D7 | No image generation in Phase 2. | User |
| D8 | Single `spec.md` until approved. | User |
| D9 | Model: `claude-sonnet-4-6`. | Inferred |
| D10 | Plan tier features (locked for design, gate later): | User |
| | • **Starter:** 7 posts, 1 image/post, text regen 1× max per post, NO image regen. | |
| | • **Pro:** 7 posts, up to 3 image regens per post, text regen 1× max per post. | |
| | • **Free trial (7 days):** identical to Pro, with the cap in D20. | |
| D11 | **Universal hard cap of 1 on text regeneration** (all plans, all users). Enforced in the service layer regardless of plan. Image regen limits are Phase 3 `imageService`. | User |
| D12 | One base image per post, used across all networks. App resizes/crops at publish (Phase 4). Never generates separate images per network. Updates Phase 3 `imageService` scope. | User |
| D13 | **REWRITTEN.** Variations are always generated server-side. The `/posts` review surface is a **wizard with one step per network the user picked in onboarding**, plus a final summary step. Per-card "Preview as" toggle (previous draft) is removed — the wizard's per-network step IS the preview. | User (this revision) |
| D14 | Scheduling is opt-in. Silence = don't post. Each `post_selections` row is an explicit user check inside the wizard. | User |
| D15 | Selection / batch lifecycle by `weekly_batches.status`: `reviewing` (wizard editable) → `scheduling` (locked, Stop is the only action) → `cancelled` (read-only forever) OR `scheduling` → `scheduled` → `completed` (Phase 4). | User |
| D16 | `weekly_batches.status` adds `"cancelled"` (type union only — no DB migration; column is `text()`). | User |
| D17 | Free trial UI signal: top-bar strip + `/create` explainer note. Both read from existing `subscriptionService.checkSubscription(userId)`. | User |
| **D18** | **Network selection is captured during onboarding** and stored on `profiles.platforms` (column already exists in the schema). Required, at least 1 network. Editable later in Settings (out of scope for Phase 2). The wizard on `/posts` shows steps for exactly the platforms in this array, in the order `facebook → instagram → linkedin`. | User (new) |
| **D19** | **`/posts` is a multi-step wizard**, not a 7-card grid: | User (new) |
| | • One step per network the user picked. Each step shows the 7 posts in *that* network's preview format (correct text variation + correct aspect-ratio placeholder), with one checkbox per card ("Post this to {Network}?", default unchecked), plus Edit + Regenerate (1× cap). | |
| | • Final step = summary: lists every selected (post, network) combination as discrete items, each with an X to remove. If empty, shows a back-to-wizard prompt. | |
| | • Single commit button on the summary: **"Schedule my pick"** → calls `postService.scheduleMyPick(batchId)` → batch locks. | |
| | • Back/Next nav across steps; selections persist (stored in `post_selections`, not local state). | |
| **D20** | **Trial users get exactly one batch total during the 7-day trial.** Once any batch exists (in *any* status, including `"cancelled"`), `generateWeekly` returns `{ ok: false, error: "trial_batch_exists" }`. Stopping the batch does NOT reset this. | User (new) |

---

## 2. Items flagged for red-line this round

See § 0 — R10 (state collapse for scheduling/cancelled), R11 (onboarding picker shape), R12 (stale-variation note copy). Everything else from prior revisions is baked in.

---

## 3. End-to-end flow this spec enables

### 3.1 Onboarding (modified)

User completes Phase 1 onboarding plus a new field:

- **Pick your networks** (D18, R11) — multi-select toggle group. At least 1 required. Saved to `profiles.platforms`. If the existing onboarding form already captures this, no UI change is needed; otherwise Phase 2 adds the step.

### 3.2 Dashboard → Create

1. `/dashboard` → "Start this week" → `/create`.
2. `/create` checks `subscriptionService.checkSubscription(userId)` AND whether a batch exists for the user:
   - **Trial user with no batch** → show explainer + trial note + form.
   - **Trial user with any batch already** → show **gated upgrade screen** instead of the form (§ 8.1.B). No generate possible.
   - **Non-trial user** → show explainer + form. (Subscription/credit gates beyond trial cap are TODO.)
3. Form submit → `postService.generateWeekly(userId, { theme, importantThing })`.
4. On success: 1 `weekly_batches` row (status `"reviewing"`), 7 `posts`, 0–14 `post_variations`, 0 `post_selections`. Redirect to `/posts?batchId=...`.

### 3.3 `/posts` — the wizard (D19)

Step count is `profile.platforms.length + 1` (one per network + summary). Example: `platforms = ["facebook", "linkedin"]` → 3 steps (FB, LI, Summary).

```
Step 1: Facebook   (7 cards in FB preview, each with one "Post to Facebook?" checkbox)
Step 2: LinkedIn   (7 cards in LinkedIn preview, each with one "Post to LinkedIn?" checkbox)
Step 3: Summary    (list of every checked combination; X to remove; "Schedule my pick" button)
```

If `platforms.length === 0` (data integrity bug): error state, redirect to onboarding to pick at least one. Defensive only.

Per-step:
- Header: *"Step X of Y — review for {Network}"*
- 7 cards in that network's preview format
- Each card: text for that network (canonical for FB, variation for IG/LI), aspect-ratio placeholder, **one** checkbox ("Post this to {Network}?"), Edit, Regenerate (1× cap)
- Bottom nav: Back (disabled on step 1), Next
- Selections persist across navigation (DB-backed)

Summary screen:
- Lists every selected (post, network) combination (e.g., *"Post 3 to Facebook"*, *"Post 3 to LinkedIn"*)
- Each item has an X to deselect that specific combo (calls `deselectForNetwork`)
- Empty state: *"No posts selected. Go back to pick some."* + a single Back button
- Primary action: **"Schedule my pick"** → `postService.scheduleMyPick(batchId)` → batch locks

### 3.4 Post-commit and cancellation

After "Schedule my pick":
- `batch.status` → `"scheduling"`. The wizard is replaced (R10) with a **read-only summary view** + a **"Stop entire batch"** button.
- Phase 4 picks up from `"scheduling"`, assigns times via the calendar, transitions to `"scheduled"` → `"completed"`.

If the user clicks "Stop entire batch":
- `batch.status` → `"cancelled"`. Same read-only summary view, no Stop button, no actions. Final state for Phase 2.

### 3.5 Phase 4 hand-off

Phase 4 will read `weekly_batches.status === "scheduling"` + the existing `post_selections` rows to build the calendar UI and create `scheduled_posts` rows with `scheduledTime`. Phase 4 will also implement **individual post unschedule/reschedule** within a committed batch — see § 11.

---

## 4. Database changes — migration `0003`

### 4.1 `posts` — add two columns (unchanged from prior)

```ts
feedback: text("feedback"),                                // nullable
regenerationCount: integer("regeneration_count")
  .default(0)
  .notNull(),
```

### 4.2 New table `post_variations` (unchanged)

```ts
export const postVariations = pgTable(
  "post_variations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),     // "instagram" | "linkedin"
    postText: text("post_text").notNull(),
    hashtags: text("hashtags").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("post_variations_post_platform_unique").on(table.postId, table.platform),
    index("post_variations_user_id_idx").on(table.userId),
  ]
);
```

### 4.3 New table `post_selections` (R7, unchanged)

```ts
export const postSelections = pgTable(
  "post_selections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),     // "facebook" | "instagram" | "linkedin"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("post_selections_post_platform_unique").on(table.postId, table.platform),
    index("post_selections_user_id_idx").on(table.userId),
  ]
);
```

Row presence = selected. Facebook is explicit here (selecting FB is an opt-in, not a default).

### 4.4 `weekly_batches.status` union (D16, unchanged)

TypeScript only, no DB migration:

```ts
export type BatchStatus =
  | "in_progress"
  | "reviewing"
  | "scheduling"
  | "scheduled"
  | "completed"
  | "cancelled";        // NEW
```

### 4.5 Status flow (unchanged)

```
reviewing  ──[Schedule my pick]──>  scheduling  ──[Phase 4 calendar+cron]──>  scheduled  ──>  completed
                                       │
                                       └──[Stop entire batch]──>  cancelled
```

### 4.6 `profiles.platforms` — no schema change needed (D18)

The column already exists: `text("platforms").array().notNull()`. Phase 2 just ensures the onboarding form writes to it. If the existing onboarding code already does, no work in this area.

### 4.7 Migration filename

Drizzle-generated: `drizzle/0003_*.sql` + `drizzle/meta/0003_snapshot.json`.

---

## 5. File and folder layout

```
src/
  lib/
    ai/
      anthropic.ts                       (existing — no changes)
      website-analyzer.ts                (existing — reference pattern)
      post-generator.ts                  NEW
    services/
      post-service.ts                    REPLACE stub with real impl
      profile-service.ts                 (existing)
      subscription-service.ts            POSSIBLE small addition — see § 6.1
    schema.ts                            MODIFIED — see § 4
  app/
    (app)/
      (onboarded)/
        create/
          page.tsx                       REPLACE "Coming soon" — D17 banner + D20 gated mode + form
          actions.ts                     NEW — generateWeeklyAction with trial-cap check
        posts/
          page.tsx                       REPLACE "Coming soon" — branches by batch.status
          actions.ts                     NEW — server actions for selection toggle, edit, regen, scheduleMyPick, stop
      onboarding/
        page.tsx                         MODIFIED if existing form lacks the platforms picker
        actions.ts                       MODIFIED similarly
  components/
    create/
      generate-form.tsx                  NEW
      trial-note.tsx                     NEW
      trial-gated-screen.tsx             NEW — D20 upgrade nudge
    posts/
      network-wizard.tsx                 NEW — orchestrator, holds current-step index
      wizard-step.tsx                    NEW — single network step (7 inline cards)
      wizard-summary.tsx                 NEW — summary list + Schedule my pick
      wizard-nav.tsx                     NEW — Back / Next / Schedule buttons
      regenerate-dialog.tsx              NEW
      edit-dialog.tsx                    NEW
      locked-summary.tsx                 NEW — read-only summary for scheduling/cancelled (R10)
    onboarding/
      onboarding-form.tsx                MODIFIED if it doesn't already have the platforms multi-select
    dashboard/
      top-bar.tsx                        MODIFIED — append <TrialStrip /> when status === 'trial'
drizzle/
  0003_*.sql                             NEW
  meta/
    0003_snapshot.json                   NEW
specs/
  phase-2-post-generation/
    spec.md                              THIS FILE
```

Removed from prior revision: `post-card.tsx`, `preview-as-toggle.tsx`, `post-review-grid.tsx`, `batch-controls.tsx`. All superseded by wizard components.

---

## 6. Service-layer API

### 6.1 `postService.generateWeekly` — adds D20 trial check

```ts
async generateWeekly(
  userId: string,
  input: { theme: string; importantThing: string }
): Promise<GenerateWeeklyResult>;

type GenerateWeeklyResult =
  | { ok: true; batchId: string; postsCreated: number; variationsCreated: number }
  | { ok: false;
      error:
        | "no_profile"
        | "trial_batch_exists"          // NEW per D20
        | "ai_failed"
        | "db_failed";
      details?: string };
```

**Order of checks at the top of the function:**

1. `profileService.get(userId)` → if null, return `no_profile`.
2. **Trial-batch cap (D20):**
   - Read subscription via `subscriptionService.checkSubscription(userId)`.
   - If `subscription.status === "trial"`:
     - Query `weekly_batches` for `userId` — `SELECT 1 FROM weekly_batches WHERE user_id = ? LIMIT 1`.
     - If any row exists (any status — `reviewing`, `scheduling`, `scheduled`, `cancelled`, `completed`), return `{ ok: false, error: "trial_batch_exists" }`.
3. **TODO** `// TODO(phase-3-gating): credit/subscription gate for non-trial users (Starter weekly cycle, PAYG balance, etc.)`
4. Build prompt → call `postGenerator.generate(...)` → handle null with `ai_failed`.
5. Persist in one transaction → on throw return `db_failed`.
6. Return success.

**Optional refactor:** introduce `subscriptionService.canGenerate(userId)` returning `{ allowed: true } | { allowed: false; reason: string }`. Phase 2 implementation: just the trial-batch check. Phase 3 expands to plan/credit logic. **Recommendation:** add this method now (1-screen of code) so the gate site is permanently in one place. Otherwise inline the check in `generateWeekly` and leave a TODO. I'll add `canGenerate` unless you say otherwise.

### 6.2 `postGenerator.generate` (unchanged — § 6.2 from prior revisions)

Variations are still generated for both Instagram and LinkedIn regardless of `profile.platforms`. The wizard simply doesn't show steps for networks not in `platforms`. Wasted tokens for users on fewer-than-3 platforms — explicit accepted cost (D4).

If you want token-saving later, the LLM call can read `profile.platforms` and tell the model to only produce variations for those platforms. Spec-level note; do NOT implement in Phase 2.

### 6.3 `postService.regenerate(postId, feedback)` (unchanged from prior)

Errors: `not_found`, `not_owned`, `regeneration_limit_reached` (D11), `batch_locked`, `ai_failed`, `db_failed`. Universal 1× cap. Updates canonical + regenerates variations + sets `posts.status = "edited"`.

### 6.4 `postService.update(postId, updates)` (unchanged from prior)

Errors: `not_found`, `not_owned`, `batch_locked`, `db_failed`. Edits canonical text + hashtags only. Variations stay stale (R12 inline note covers this).

### 6.5 Removed methods

- `postService.confirmAll` — never wired up; replaced by `scheduleMyPick`.
- `postService.schedulePost` — per-card schedule button removed.
- `postService.scheduleAllToNetwork` — per-network bulk button removed.
- `postService.scheduleAll` — renamed to `scheduleMyPick` (§ 6.7).
- `postService.acceptPost` / `postService.skipPost` — never needed; selections imply both.

### 6.6 Selection methods (unchanged from prior)

```ts
selectForNetwork(postId, platform): { ok: true } | { ok: false; error: "not_found" | "not_owned" | "batch_locked" | "db_failed" }
deselectForNetwork(postId, platform): same shape
```

Both require `batch.status === "reviewing"`. Idempotent.

### 6.7 `postService.scheduleMyPick` — the single commit method

```ts
async scheduleMyPick(
  batchId: string
): Promise<ScheduleResult>;

type ScheduleResult =
  | { ok: true; batchId: string; committedSelections: number }
  | { ok: false;
      error:
        | "not_found"
        | "not_owned"
        | "batch_already_locked"
        | "no_selections"
        | "db_failed" };
```

**Behavior:**

1. Load batch. Missing → `not_found`. Ownership check → `not_owned`. `status !== "reviewing"` → `batch_already_locked`.
2. Count `post_selections` rows for this batch's posts. If zero → `no_selections`.
3. In a transaction:
   - `UPDATE weekly_batches SET status = 'scheduling' WHERE id = batchId AND status = 'reviewing'`. (The `AND status = 'reviewing'` clause prevents racing.)
4. Return `{ ok: true, batchId, committedSelections: <count> }`.

**Does NOT create `scheduled_posts` rows.** That's Phase 4's job once times are picked.

### 6.8 `postService.stopBatch(batchId)` (unchanged from prior)

Transitions `scheduling` → `cancelled`. Errors: `not_found`, `not_owned`, `not_scheduling`, `db_failed`.

### 6.9 Read methods (slight update for wizard)

```ts
async getBatchForReview(batchId: string, userId: string): Promise<{
  batch: WeeklyBatch;
  platforms: SelectionPlatform[];      // from profiles.platforms — drives wizard step count
  posts: Array<Post & {
    variations: { instagram?: PostVariation; linkedin?: PostVariation };
    selections: SelectionPlatform[];   // which networks are checked
  }>;
} | null>;
```

`platforms` is now included so the wizard knows which steps to render without a second query.

```ts
async getCurrentBatch(userId: string): Promise<WeeklyBatch | null>;
```

Unchanged. Returns most recent batch with `status IN ('reviewing', 'scheduling')` — used by `/posts` when no batchId query param is set.

For the trial-cap check (§ 6.1), a thinner query is enough:

```ts
async hasAnyBatch(userId: string): Promise<boolean>;
```

Single `SELECT EXISTS(...)` — cheaper than `getCurrentBatch`. Used only inside `generateWeekly`'s trial check.

---

## 7. System prompt — DRAFT (unchanged, you said keep)

Same as prior revisions. Variation rules in the prompt remain the same — variations always produced. Wizard hides them for non-selected platforms.

---

## 8. UI requirements

### 8.1 `/create` page

#### 8.1.A — Trial user with NO existing batch / non-trial user → form mode

1. **Trial banner** (D17, R9, only when `status === 'trial'`): *"You're trying Pro features free for {N} more days."*
2. **Explainer** (unchanged): *"We'll write 7 posts for Facebook this week. Pro users also get matching Instagram and LinkedIn versions of each."*
3. **Two-field form** (unchanged): `theme` (Input), `importantThing` (Textarea).
4. **Generate button** (champagne + glow, disabled while in-flight).
5. **Inline error banner** for all `GenerateWeeklyResult` failure variants:
   - `no_profile` → *"Your profile isn't set up yet."* + link to `/onboarding`.
   - `trial_batch_exists` → handled by 8.1.B render path, not the inline banner.
   - `ai_failed` → *"Couldn't reach the AI service. Try again in a minute."*
   - `db_failed` → *"Something went wrong saving your posts."*

#### 8.1.B — Trial user with an existing batch → gated upgrade screen (D20)

When `subscription.status === 'trial'` AND `postService.hasAnyBatch(userId)` returns true, replace the form with `<TrialGatedScreen />`:

- Headline: *"You've used your trial batch"*
- Body: *"Your 7-day Pro trial includes one batch of 7 posts. Upgrade to keep creating."*
- Primary CTA: *"See plans"* → links to `/pricing` (which is a placeholder route until Phase 4 ships it — for Phase 2 the link can target `/dashboard` or a stub page; flag in the task list).
- Secondary link: *"Review the batch you made"* → goes to `/posts?batchId={existingBatchId}`.

Existing-batch lookup happens server-side on `/create` page load; no flicker.

### 8.2 `/posts` review page — wizard (D13 rewritten, D19)

Branches by `batch.status`:

| Status | Render |
|---|---|
| `reviewing` | `<NetworkWizard />` — full editable wizard (§ 8.2.A) |
| `scheduling` | `<LockedSummary />` — read-only summary + Stop button (§ 8.2.B) |
| `cancelled` | `<LockedSummary />` — read-only summary, no actions (§ 8.2.C) |
| `scheduled` / `completed` | Out of scope (Phase 4) |

#### 8.2.A — Wizard (`status === "reviewing"`)

Driven by `profile.platforms`. Steps = each platform in order `facebook → instagram → linkedin` (filtered to platforms the user picked), followed by a summary step.

**Component layout** (`<NetworkWizard />`):

```
┌─ Wizard header ──────────────────────────────────────┐
│  Theme: <batch.theme>                                │
│  Highlight: <batch.important_thing>                  │
│  ────────────────────                                │
│  Step {currentStep + 1} of {steps.length}            │
│  Progress dots: ● ● ○ ○                              │
└──────────────────────────────────────────────────────┘

┌─ <WizardStep platform="facebook"> ──────────────────┐
│  Header: "Review for Facebook"                       │
│  7 cards, 1-col mobile / 2-col sm+ / 3-col lg+       │
│    (see card spec below)                             │
└──────────────────────────────────────────────────────┘

┌─ <WizardNav> ────────────────────────────────────────┐
│  [Back]                  [Next →]                    │
└──────────────────────────────────────────────────────┘
```

**Each card** (rendered inline within `<WizardStep>`):

- Top: `Post {postOrder} / 7` badge, the network icon (FB / IG / LI).
- Middle:
  - Text for *this network*: canonical for FB, variation for IG/LI. If variation row is missing for this post (rare but possible per Zod optional), show *"No variation available — toggle Edit to write one manually, or Regenerate to retry."*
  - Image area: aspect-ratio placeholder (R8: FB 1:1, IG 1:1, LI 1.91:1). Phase 2 has no images, so this is a `bg-muted` rectangle at the right ratio with a small "Image — Phase 3" label.
  - Inline **stale-variation note** (R12), only on IG / LI steps when `posts.updatedAt > postVariation.createdAt` and `posts.status === "edited"`.
- Below: a **single checkbox** with label *"Post this to {Network}?"*, default unchecked. On change → `selectForNetwork` / `deselectForNetwork`.
- Footer:
  - **Edit** (left) → opens `<EditDialog />` (textareas for canonical text + hashtags). Save updates canonical only. Variations stay stale.
  - **Regenerate** (right) → opens `<RegenerateDialog />` (feedback textarea). Submit updates canonical + replaces variations + bumps `regeneration_count`. Button is disabled (with tooltip *"You've already regenerated this post."*) when `regeneration_count >= 1`.

**`<WizardNav>` rules:**

- **Back**: disabled on step 1. Otherwise navigates to previous step (URL `?step=N`, or local state — either works since selections are DB-backed).
- **Next**: visible on all network steps. Disabled never (user can advance with zero selections; they catch the empty-state at the summary).
- On the summary step: nav swaps to a different shape — no Next button; instead the "Schedule my pick" button is the bottom action (rendered inside `<WizardSummary />`, not `<WizardNav>`).

**`<WizardSummary />` (last step):**

```
┌─ Summary ────────────────────────────────────────────┐
│  Header: "Review your week"                          │
│  Subhead: "Here's everything you've picked. Remove   │
│           anything you don't want before scheduling."│
│                                                      │
│  • Post 1 to Facebook              [×]               │
│  • Post 1 to Instagram             [×]               │
│  • Post 3 to LinkedIn              [×]               │
│  • Post 5 to Facebook              [×]               │
│  ...                                                 │
│                                                      │
│  [← Back to LinkedIn step]   [Schedule my pick]      │
└──────────────────────────────────────────────────────┘
```

- Each line item shows the post text excerpt (first ~80 chars) + the network icon.
- The `×` button calls `deselectForNetwork(postId, platform)` and the line disappears.
- **Empty state**: *"No posts selected. Go back to pick at least one."* + a Back button. The "Schedule my pick" button is hidden.
- **"Schedule my pick"** is champagne primary + `glow-champagne`. On click → `postService.scheduleMyPick(batchId)`. Returns:
  - `ok: true` → redirect to `/posts?batchId=...` (same page; `batch.status` is now `scheduling`; renders 8.2.B).
  - `error: "no_selections"` → defensive only; UI shouldn't allow this state but show inline error if it happens.
  - `error: "batch_already_locked"` → unlikely race; redirect to refresh state.

#### 8.2.B — Locked summary (`status === "scheduling"`) (R10)

`<LockedSummary />` is the same visual as `<WizardSummary />` but:

- No `×` buttons on items.
- No Back nav.
- The primary action is replaced with **"Stop entire batch"** (warm-coral destructive variant per DESIGN.md, NOT screaming red).
- Subhead becomes: *"Your selections are locked. Stopping will cancel the batch."*

On Stop click → confirmation dialog (*"This cancels the batch. Nothing posts. Continue?"*) → `postService.stopBatch(batchId)` → reload page (renders 8.2.C).

#### 8.2.C — Cancelled (`status === "cancelled"`) (R10)

Same `<LockedSummary />` shape:

- No Stop button.
- Banner near top: *"This batch was cancelled. Nothing was posted."* + link *"Start a new batch"* → `/create`. (For trial users with `trial_batch_exists`, the link still goes to `/create` and the gated screen takes over from there.)
- The post-network items are still listed (read-only), so the user can see exactly what they had committed.

#### 8.2.D — Stale-variation inline note copy (R12)

Rendered inside `<WizardStep>` (only IG / LinkedIn steps), only when the variation is older than the post's last edit. Single line, `text-xs text-muted-foreground` italic:

> *"You edited this post on the Facebook step — the {Network} version may be older. Regenerate (1 left) to refresh both."*

If `regenerationCount >= 1`, drop the "(1 left)" parenthetical: *"Regenerate to refresh both"* would be misleading (button is disabled), so use: *"Edit this post to update both."*

### 8.3 Free trial signaling (D17, R9 — unchanged)

- `<TrialStrip />` inside `DashboardTopBar`, visible only when `subscription.status === 'trial'`. Copy: *"Pro trial — {N} days left."*
- `<TrialNote daysLeft={N} />` inside `/create` between title and form, only on trial. Copy: *"You're trying Pro features free for {N} more days."*

Both pull from `subscriptionService.checkSubscription(userId)`.

For trial users in the gated state (§ 8.1.B), neither `TrialNote` nor `<TrialGatedScreen />` need each other — `TrialGatedScreen` already explains the situation. Don't double-stack the message.

### 8.4 Sidebar — no changes

### 8.5 Onboarding modification (D18, R11)

Add a step (or field) to the existing onboarding flow capturing `profiles.platforms`. **Implementation should first check if the existing onboarding-form.tsx already collects this** — Phase 1 schema has the column; Phase 1 may or may not have wired the UI. If absent:

- Position: after `tonePreference`, before submit.
- Question: *"Where do you want to post?"*
- Subhead: *"Pick the networks we should create content for. You can change this later."*
- Control: **multi-select toggle group**, three options shown with platform icons:
  - **Facebook**
  - **Instagram**
  - **LinkedIn**
- Validation: at least 1 must be selected.
- Save to `profiles.platforms` as an array of the union members.
- The existing server action (`src/app/(app)/onboarding/actions.ts`) writes the array.

**Future enhancement, NOT in Phase 2:** per-network weekly post-count questions (*"How many Facebook posts? 1–7. Instagram? LinkedIn?"*). Phase 2 always produces 7 canonical posts.

---

## 9. Database writes

### 9.1 generateWeekly (unchanged — see prior § 9.1)

Plus the trial-cap check is a *read* (not a write) inserted before the transaction begins.

### 9.2 Selection toggle (unchanged)

```sql
-- selectForNetwork
INSERT INTO post_selections (id, post_id, user_id, platform)
  VALUES (uuid, postId, userId, platform)
  ON CONFLICT (post_id, platform) DO NOTHING;

-- deselectForNetwork
DELETE FROM post_selections WHERE post_id = postId AND platform = platform;
```

### 9.3 scheduleMyPick (D19) — the only commit

```sql
BEGIN
  -- Validation: at least one selection
  SELECT count(*)
    FROM post_selections ps JOIN posts p ON p.id = ps.post_id
    WHERE p.batch_id = batchId;
  -- abort with no_selections if zero

  -- Lock the batch (race-safe via status guard)
  UPDATE weekly_batches
    SET status = 'scheduling'
    WHERE id = batchId AND status = 'reviewing';
  -- if 0 rows updated → batch_already_locked
COMMIT
```

### 9.4 stopBatch (unchanged)

```sql
UPDATE weekly_batches SET status = 'cancelled' WHERE id = batchId AND status = 'scheduling';
```

### 9.5 regenerate (unchanged from prior § 9.7)

### 9.6 Removed sections

- Old § 9.3 (`schedulePost`) — removed (method gone).
- Old § 9.4 (`scheduleAllToNetwork`) — removed (method gone).

---

## 10. Error handling

### 10.1 The AI call (unchanged — never throws, returns null)

### 10.2 Service-layer error discriminators (updated)

| Method | Errors |
|---|---|
| `generateWeekly` | `no_profile`, **`trial_batch_exists`** (new), `ai_failed`, `db_failed` |
| `regenerate` | `not_found`, `not_owned`, `regeneration_limit_reached`, `batch_locked`, `ai_failed`, `db_failed` |
| `update` | `not_found`, `not_owned`, `batch_locked`, `db_failed` |
| `selectForNetwork` / `deselectForNetwork` | `not_found`, `not_owned`, `batch_locked`, `db_failed` |
| `scheduleMyPick` | `not_found`, `not_owned`, `batch_already_locked`, `no_selections`, `db_failed` |
| `stopBatch` | `not_found`, `not_owned`, `not_scheduling`, `db_failed` |

Removed: `schedulePost`, `scheduleAllToNetwork` rows.

### 10.3 Partial-failure on generation (unchanged)

### 10.4 UI error copy (updated)

- `trial_batch_exists` → **never reaches the inline banner** — handled by `<TrialGatedScreen />` at page load (§ 8.1.B).
- `regeneration_limit_reached` → defensive only (button disabled before user can press it).
- `batch_locked` / `batch_already_locked` → *"This batch is locked. To cancel, click Stop entire batch."*
- `no_selections` (on `scheduleMyPick`) → button should be disabled when summary is empty; defensive copy: *"Pick at least one post-network combination first."*
- `not_scheduling` → defensive only.

---

## 11. What this spec deliberately does NOT cover

| Concern | Where it goes | Phase 2 stub |
|---|---|---|
| Image generation | Phase 3 `imageService` — one base image per post, plan-gated regeneration (Starter 0 / Pro 3 / Trial = Pro within trial-batch-cap). | `post_images` table stays empty. |
| Per-network image resize/crop | Phase 4 `postingService` (immediately before publish). | Phase 2 uses CSS aspect-ratio placeholders only. |
| Active subscription enforcement beyond trial cap | Phase 3 (credit) + Phase 4 (payment) | TODOs at gate sites + the optional `subscriptionService.canGenerate(userId)` shell. |
| Trial creation / conversion / billing | Phase 4 Payment_Integration | Phase 2 only *reads* `subscriptions.status` for the trial-batch cap and banner; doesn't write. |
| Calendar / time-picker | Phase 4 Scheduling_and_Auto_Posting | Phase 2 stops at `status === "scheduling"`. |
| OAuth account connection | Phase 4 | None. |
| Cron / actual posting | Phase 4 | None. |
| **Individual post unschedule / reschedule** within a committed batch | **Phase 4** — needed for real-world emergencies (town events, breaking news, etc.). The pattern is: a scheduled post can be moved or removed without cancelling the entire batch. Phase 2's only "undo" is `stopBatch` (whole-batch cancel). | None. |
| Per-network post-count onboarding questions | Future enhancement, post-Phase-2. | None. |
| Pricing / upgrade flow (linked from `<TrialGatedScreen />`) | Phase 4 Payment_Integration | Phase 2 stubs the link target (probably `/pricing` returning a placeholder, OR link to `/dashboard` until Phase 4 lands). Decide in task split. |
| Editing `profile.platforms` from Settings | Out of scope for Phase 2. Onboarding sets it; Settings UI is a later task. | Direct DB edit possible during development. |
| Skipped/accepted post states | D14 makes them redundant. Union values stay in the type, Phase 2 doesn't write them. | None. |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Trial-batch cap is unforgiving.** User generates, hates the output, can't generate again. | Documented behavior per D20. Edit (unlimited) + Regenerate (1×) inside the wizard are the escape hatches. If complaints accumulate, the "reset cancelled trial batches" policy is a 1-line change. |
| **Wizard step count depends on `profile.platforms`.** A user with `platforms = []` (data bug) breaks the wizard. | Defensive: if `platforms.length === 0`, redirect to `/onboarding` with a message. Surfaced in § 3.3. |
| **Variations always generated even when the user picked only 1 platform.** Wasted tokens. | Accepted (D4). Token-saving optimization deferred. |
| **Stale variations after Edit.** User edits FB caption; IG/LinkedIn texts now older. | R12 inline note explains it. Regenerate refreshes both. |
| **Onboarding may not currently capture `platforms`.** Phase 2 adds it without breaking Phase 1 users. | Task split flags this. If the current Phase 1 onboarding form lacks the picker, add it as a focused task. Existing users without `platforms` set: defensive redirect from `/posts` to `/onboarding` to fill it in. |
| **`trial_batch_exists` is checked on every `/create` page load AND inside `generateWeekly`.** Belt-and-braces. | Two cheap reads. Worth the defensive duplication so the server action can't be tricked by direct POST. |
| **`scheduleMyPick` race on `weekly_batches.status` update.** Two browser tabs hitting Schedule at the same time. | The `AND status = 'reviewing'` guard means one wins; the other returns `batch_already_locked` and the UI reloads. |
| **Trial banner stale day count** (carried from prior). | Acceptable. |
| **`max_tokens: 8000` truncation on Pro batches** (carried). | Log `stop_reason === 'max_tokens'`; raise to 12000 if it fires. |

---

## 13. Definition of done

- [ ] Migration `0003` generated, reviewed, applied locally (no `db:push`).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` all clean.
- [ ] R10, R11, R12 confirmed (or struck through with new direction).
- [ ] Onboarding writes `profile.platforms` (verify in Drizzle Studio after a fresh signup).
- [ ] Trial user can generate exactly one batch. Second attempt shows `<TrialGatedScreen />`. Cancelling does NOT reset.
- [ ] `/create` form mode + gated mode both render correctly based on subscription status + existing batch.
- [ ] `/posts` wizard:
  - [ ] Step count matches `profile.platforms.length + 1`.
  - [ ] Each network step shows 7 cards in that network's text + aspect ratio.
  - [ ] Checkbox toggles persist across navigation (DB-backed).
  - [ ] Edit dialog updates canonical only; stale-variation note appears on IG/LI steps after edit.
  - [ ] Regenerate disabled after 1 use; tooltip explains.
  - [ ] Summary lists all selected combinations; X removes individual items.
  - [ ] Empty summary shows back-prompt + hides Schedule button.
  - [ ] Schedule my pick → batch locks → page re-renders as locked summary.
- [ ] `/posts` locked summary:
  - [ ] No Edit/Regenerate/checkbox controls.
  - [ ] Stop entire batch button present (only in `scheduling`).
  - [ ] Cancelled state shows the banner + new-batch link.
- [ ] Trial banner renders in TopBar AND in `/create` form-mode only when `status === 'trial'`. Hidden in gated mode.
- [ ] All TODO sites for plan/credit gating marked with `TODO(phase-3-gating)` (single grep marker).
- [ ] Security pass: every new server action checks session + ownership.

---

## 14. After sign-off

Once R10/R11/R12 are confirmed, split into tasks:

- `tasks/task-01-schema-migration.md` — migration 0003 (posts columns, post_variations, post_selections, status union, types).
- `tasks/task-02-post-generator.md` — `src/lib/ai/post-generator.ts` (Anthropic module + § 7 prompt + tool schema + Zod).
- `tasks/task-03-post-service-generate.md` — `generateWeekly` + trial-cap check + `subscriptionService.canGenerate` + `hasAnyBatch`.
- `tasks/task-04-post-service-mutations.md` — `update`, `regenerate`, `selectForNetwork`, `deselectForNetwork`.
- `tasks/task-05-post-service-commit.md` — `scheduleMyPick` + `stopBatch` + race-safe SQL.
- `tasks/task-06-onboarding-platforms.md` — add platforms multi-select to onboarding form (if missing).
- `tasks/task-07-create-page.md` — form mode + gated mode + trial banner + server action.
- `tasks/task-08-posts-wizard-skeleton.md` — `<NetworkWizard />` + `<WizardNav />` + step routing.
- `tasks/task-09-posts-wizard-step.md` — `<WizardStep />` cards, checkbox, edit/regen wiring, stale-variation note.
- `tasks/task-10-posts-wizard-summary.md` — `<WizardSummary />` + Schedule my pick action.
- `tasks/task-11-posts-locked-summary.md` — `<LockedSummary />` for scheduling + cancelled states.
- `tasks/task-12-dialogs.md` — `<EditDialog />` + `<RegenerateDialog />`.
- `tasks/task-13-trial-strip.md` — `DashboardTopBar` trial signaling.
- `tasks/task-14-security-and-typecheck.md` — ownership audit + lint/typecheck/build pass.
