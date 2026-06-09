# Onboarding posting-preferences — spec

## Context

UniqueMe's onboarding form is a single page (business name, website URL, description, tone, platforms). The crawler fires on URL blur and the suggested description lands in the textarea by the time the user reaches it. From `/onboarding/done` the user later triggers their first batch via `/create`, which calls `postService.generateWeekly` → `postGenerator.generate`. `weekly_batches` already has a `post_length` column (`short | medium | long`, NULL = treat as medium) and the `/create` form already exposes a length picker.

This spec adds two narrowly-scoped capabilities:

**(A) Onboarding — one new question: posting days.** Inline in the existing form, **directly under the URL field**, above the description textarea. No restructuring; no new route. Bonus: answering this gives the crawler a little more headroom before the description field needs the suggested draft.

**(B) Length picker — add "Mix" as a 4th option to the existing `/create` length picker.** No onboarding question for length. Mix means balanced length distribution across the batch's posts, deterministic per `batchId`.

### Posting-days rule (uniform calendar filter)

- Lay out the batch's consecutive calendar days from `batch.createdAt`: 7 days for Starter/Trial, 9 days for Pro batch 4.
- Apply the filter:
  - `every_day` → keep every day.
  - `working_days_only` → keep Mon–Fri; drop Sat + Sun.
  - `weekends_only` → keep Sat + Sun; drop Mon–Fri.
- Post count is whatever falls out. No tier-specific lookups; no stretching across extra calendar days; no forced Monday start.

| Posting days | 7-day window | 9-day window |
|---|---|---|
| `every_day` | 7 posts | 9 posts |
| `working_days_only` | always 5 posts | 5, 6, or 7 posts (depends on start day) |
| `weekends_only` | always 2 posts | 2, 3, or 4 posts (depends on start day) |

---

## 1. Data model

### New / changed columns

| Table | Column | Type | Union (app-layer) | Default / back-compat |
|---|---|---|---|---|
| `profiles` | `posting_days` | `text` (nullable) | `every_day \| working_days_only \| weekends_only` | NULL on legacy rows → service-layer reads NULL as `every_day` |
| `weekly_batches` | `posting_days` | `text` (nullable) | `every_day \| working_days_only \| weekends_only` | NULL → calendar reader treats as `every_day` |
| `weekly_batches` | `day_window` | `integer` (nullable) | `7 \| 9` | NULL on legacy rows → fall back to `total_posts` (existing semantics) |
| `weekly_batches` | `post_length` (existing) | widen union | `short \| medium \| long \| mix` | NULL still → medium |

**Why a new `day_window` column.** Today `weekly_batches.total_posts` doubles as both "number of posts" and "calendar span" (always equal under `every_day`). After this change they diverge — `working_days_only` on a 9-day window can produce 5, 6, or 7 posts. We keep `total_posts` meaning "number of posts written" and introduce `day_window` meaning "calendar span in consecutive days". The pair `(day_window, posting_days)` defines the filtered slot list; `total_posts` is the resulting count.

No new column for post length on `profiles` — length stays per-batch on `/create`.

### Why store `posting_days` on both `profiles` and `weekly_batches`

- `profiles.posting_days` = persistent user preference, seeded in onboarding, editable in Settings, seeds every new batch row.
- `weekly_batches.posting_days` = frozen on the batch row at creation so editing Settings later never retroactively shifts a past batch's calendar / post count.

Same freeze-at-creation pattern as the existing `weekly_batches.post_length`.

### Migration

`drizzle generate` + `drizzle migrate` per `AGENTS.md` (never `push`). Existing rows stay NULL; service-layer readers fall back to `every_day` / `day_window = total_posts`. No data backfill needed.

---

## 2. Onboarding — single field added

Edit `src/components/onboarding/onboarding-form.tsx`:

- Insert **one** field block between the URL group (~lines 440–532) and the description textarea (~lines 533+).
- Control: radio group / segmented control, three options:
  - **Every day** — *one post for every day of your batch.*
  - **Working days only** — *Monday through Friday.*
  - **Weekends only** — *Saturday and Sunday.*
- Default: **Every day**.
- Microcopy (italic Fraunces, matches existing tone caption): *"Sets your default. Editable any time in Settings."*

Server action (`src/app/(app)/onboarding/actions.ts`):

- Add `posting_days: z.enum(["every_day", "working_days_only", "weekends_only"]).default("every_day")` to `onboardingFormSchema`.
- Extend `SaveProfileInput` and `profileService.saveProfile` to persist `postingDays` to the new `profiles.posting_days` column.

Crawler is untouched — it still fires on URL blur and fills the description draft as today.

---

## 3. Generation — how posting-days changes the batch

### Calendar plan resolution at batch creation

New pure helper `src/lib/scheduling/batch-calendar.ts`:

```
type CalendarPlan = { totalPosts: number; dayOffsets: number[] };

function resolveBatchPlan(
  batchCreatedAt: Date,
  dayWindow: 7 | 9,
  postingDays: PostingDays
): CalendarPlan
```

Algorithm:
1. Build `candidateOffsets = [0, 1, …, dayWindow - 1]`.
2. Map each offset to its day-of-week via `(batchCreatedAt + offset days)`.
3. Filter by `postingDays`:
   - `every_day` → keep all.
   - `working_days_only` → keep where `dow ∈ {Mon..Fri}`.
   - `weekends_only` → keep where `dow ∈ {Sat, Sun}`.
4. `dayOffsets = filtered`; `totalPosts = dayOffsets.length`.

`dayWindow` is derived from the batch's tier at creation time (Starter/Trial → 7; Pro batch 4 → 9; other Pro batches per existing rules). The tier mapping already exists in `generateWeeklyAction`; we pass it explicitly into `resolveBatchPlan` and persist as `weekly_batches.day_window`.

### Calendar render

`src/lib/scheduling/ordinal-to-date.ts` (new, pure):

```
function ordinalToDate(
  batchCreatedAt: Date,
  ordinal: number,                    // 1..totalPosts
  dayWindow: 7 | 9,
  postingDays: PostingDays
): Date
```

Re-derives `dayOffsets` via `resolveBatchPlan` and returns the `(ordinal - 1)`th. Pure, no I/O, deterministic. Used by `batch-detail-view.tsx` and any other current callsite that does inline `createdAt + (order - 1) * DAY_MS`. Grep targets: `* DAY_MS`, `* 86_400_000`.

### `postService.generateWeekly` flow

1. Receive theme, importantThing, `dayWindow` (7 or 9), `postLength` (now incl. `mix`).
2. Read `profile.postingDays`; call `resolveBatchPlan(now, dayWindow, postingDays)` → `{ totalPosts, dayOffsets }`.
3. Insert `weekly_batches` row with `total_posts = totalPosts`, `day_window`, `posting_days`, `post_length`.
4. Call `postGenerator.generate(profile, batchMeta, lengths)` where `lengths = resolveLengthsForBatch(totalPosts, postLength)` (one per slot).
5. Insert `posts` rows with `postOrder` 1..totalPosts.

### Variable-count callsite audit (load-bearing)

Anywhere that hardcodes 7 (or 9) as "the batch size" must instead read `weekly_batches.total_posts`. Likely surfaces: schedule grid columns, regenerate cap math, accepted/skipped counters, dashboard "X of Y posts" labels. Wave 2 task 6 owns this audit explicitly.

---

## 4. Length picker — add "Mix" as 4th option

### UI change

In the existing `/create` length picker (likely `src/components/create/generate-form.tsx` — confirm at implementation): add **Mix (Recommended)** as the 4th option. Defaults shift so Mix is preselected.

### Schema change

Widen the app-layer `PostLength` union in `src/lib/schema.ts` to `"short" | "medium" | "long" | "mix"`. Text column unchanged at the DB.

### Mix resolution at generation time

New helper `resolveLengthsForBatch(totalPosts, postLength): PostLength[]`:

- `short | medium | long` → uniform array of length `totalPosts`.
- `mix` → balanced distribution shuffled with seeded RNG (seed = `batchId`, so a single-post regenerate never reshuffles the others).

**Balanced distribution for arbitrary N** (the variable-count rule means N can be 2, 3, 4, 5, 6, 7, or 9):

```
short  = floor(N / 3)
long   = floor(N / 3) + (1 if N % 3 >= 2 else 0)
medium = N - short - long
```

Resulting splits:

| N | S | M | L |
|---|---|---|---|
| 2 | 0 | 1 | 1 |
| 3 | 1 | 1 | 1 |
| 4 | 1 | 2 | 1 |
| 5 | 1 | 2 | 2 |
| 6 | 2 | 2 | 2 |
| 7 | 2 | 3 | 2 |
| 9 | 3 | 3 | 3 |

N=2 uses the general algorithm: `[medium, long]` (no special case).

`postGenerator.generate` is refactored to accept `lengths: PostLength[]` rather than a single string; prompt emits per-slot length directives. Uniform arrays for non-Mix batches behave identically to today.

---

## 5. Settings UI for editing posting-days

`src/app/(app)/(onboarded)/settings/page.tsx` currently renders only `<PlanSection />`. Add a sibling card `<PostingDaysSection />` below it:

- One control (radio / select) mirroring the onboarding field.
- Save via new server action `updatePostingDaysAction` → writes `profiles.posting_days`.
- Toast on save: *"Posting days updated."*
- Microcopy below the control: *"Applies to your next batch. Current batches stay as planned."*
- Small preview line: *"≈ N posts per batch"* (best-effort, given `day_window` and chosen filter; for variable-count cases shows a range like *"5–7 posts per batch"*).

Card pattern matches existing: Fraunces title, `p-8`, `rounded-2xl shadow-soft`. No length picker in Settings — length stays a per-batch choice on `/create`.

---

## 6. Resolved decisions & conflicts

### Decisions (locked)

- **Mix N=2** → general algorithm: `[medium, long]` (skip short). No special case.
- **`/create` posting-days override** → silently inherit from `profile.posting_days`. No per-batch override on `/create`. Posting-days is changed only in onboarding (first time) or Settings.
- **Calendar storage** → derive at read time. No `posts.day_offset` column. `ordinalToDate(createdAt, dayWindow, postingDays, ordinal)` is pure and deterministic; called by the schedule grid and any other render that needs a date.

### Conflicts with existing behaviour

- **Variable post counts break "batch size = 7 or 9" assumptions.** Callsites that hardcode the count must read `weekly_batches.total_posts`. Audit during Wave 2 task 6.
- **Pro plan economics.** Under `weekends_only`, a Pro user with 4 batches/30 days could ship as few as 8 posts/30 days (vs current ~32). Intentional per the spec — "fewer posts is the user's choice" — surfaced to the user via Settings preview line.
- **Mix as new default on `/create`.** Returning users who currently land on `medium` will now land on Mix. That's the intent of the option, but it's a behavioural shift worth flagging in the change log.
- **Legacy batches (NULL `day_window`, NULL `posting_days`).** Calendar reader treats NULL `posting_days` as `every_day` and NULL `day_window` as `total_posts`. Existing batches render identically. No backfill required.

---

## 7. Wave / task breakdown

### Wave 1 — foundations (sequential)
1. **Schema:** add `profiles.posting_days`, `weekly_batches.posting_days`, `weekly_batches.day_window`; widen `PostLength` union to include `mix`; add `PostingDays` union. Drizzle `generate` + `migrate` (one at a time, each gated on user approval).
2. **Service-layer types:** extend `SaveProfileInput` + `profileService.saveProfile`; extend batch-creation input to accept `dayWindow`, `postingDays`, and `postLength = "mix"`.

### Wave 2 — parallel (4 tracks)
3. **Onboarding form:** insert single new field between URL group and description block; extend `onboardingFormSchema` + `saveOnboardingAction`.
4. **Length picker:** add Mix (Recommended) 4th option to existing `/create` length picker; default to Mix.
5. **Generation:** implement `resolveBatchPlan` and `resolveLengthsForBatch`; wire into `postService.generateWeekly`; refactor `postGenerator.generate` to accept `lengths: PostLength[]`.
6. **Calendar helper + audit:** add `src/lib/scheduling/ordinal-to-date.ts`; replace inline `createdAt + (order-1) days` callsites; **audit any hardcoded 7/9 batch-size assumptions** and migrate to `weekly_batches.total_posts`.

### Wave 3 — Settings & verification
7. **Settings UI:** add `<PostingDaysSection />` card + `updatePostingDaysAction`; include the "≈ N posts per batch" preview line.
8. **`/create` wiring:** extend `generateWeeklyAction` to read `profile.postingDays` and the computed `dayWindow`, call `resolveBatchPlan`, seed the batch row.
9. **Verification (manual):** see §8.

---

## 8. Verification plan (manual checks)

| Check | How |
|---|---|
| New field renders under URL | `/onboarding` while signed in with no profile. |
| Crawler still works | Type a URL, immediately answer the new field, then watch the description spinner + suggested draft appear. |
| Persistence | After onboarding, `profiles.posting_days` populated. |
| 7-window every_day → 7 posts | Default Starter flow. |
| 7-window working_days_only → 5 posts (always) | Set Settings to working_days, trigger Starter batch on any day. |
| 7-window weekends_only → 2 posts (always) | Same, weekends_only. |
| 9-window working_days_only → 5–7 posts depending on start day | Trigger Pro batch 4 on a Monday vs Saturday; confirm counts vary. |
| Mix 7 → 2/3/2 distribution | Pick Mix on `/create`, run 7-post batch, inspect post lengths. |
| Mix 5 → 1/2/2 | Same, but with working_days_only Starter. |
| Calendar labels skip non-matching days | Visit `/schedule/[batchId]` after each combo. |
| Settings edit doesn't move past batches | Change pref, confirm prior batch calendar unchanged. |
| Back-compat | A pre-migration batch (NULL `posting_days`, NULL `day_window`) renders identically to today. |
| Quality gates | `pnpm lint`, `pnpm typecheck`, `pnpm next build`. |
