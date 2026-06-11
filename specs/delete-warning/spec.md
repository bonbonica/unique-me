# Delete-warning copy — spec

## Context

The quota-soft-delete fix (commit `a019264`) made `deleteBatchForever` a tombstone op: the `weekly_batches` row is preserved with `deleted_at = now()` so the three quota gates (trial existence, Starter rolling-7-day, Pro rolling-30-day count) keep seeing it and don't refund the slot. The user-visible card disappears from `/create`, but the slot stays consumed.

That fix closed the bypass — and introduced a new confusion: the user clicks **Delete forever** expecting "now I can make another," and instead hits a wall the moment they try to generate. The gated screen explains the wait, but it does so AFTER the destructive action, not before. We need to warn BEFORE delete and offer the better path (edit the posts, keep the full set).

This spec defines the confirm-dialog rewrite. Tier-aware copy, with the user's real remaining count and next-available date filled in dynamically.

---

## Investigation findings

### 1. Where the delete action is triggered today

The destructive trigger lives on cancelled batch cards on the `/create` hub.

| Surface | File | Detail |
|---|---|---|
| Page | `src/app/(app)/(onboarded)/create/page.tsx` | Server component. Loads `subscription = subscriptionService.checkSubscription(userId)` and `cards = postService.getUnscheduledBatchesForUser(userId)`. Passes `cards` into `<UnscheduledBatchList />` via `belowButtonsSlot` composition. |
| List | `src/components/create/unscheduled-batch-list.tsx` | Server component. Renders each card via `<UnscheduledBatchCard />`. |
| Card | `src/components/create/unscheduled-batch-card.tsx` | Server component. On `status === "cancelled"` cards, renders `<DeleteBatchForeverTrigger batchId imageCount />` in the bottom-right action slot (line 121). |
| Trigger | `src/components/create/delete-batch-forever-trigger.tsx` | Client component (`"use client"`). Owns the `open` state for the dialog. Button label: `"Delete forever"`. |
| Dialog | `src/components/create/delete-batch-forever-dialog.tsx` | Client component. Submits via `deleteBatchForeverAction(batchId)` → `postService.deleteBatchForever`. Current copy is generic ("The batch and its posts will be removed. {N} images will move to your Image Library...") — no quota warning, no edit-instead path. |

The dialog already exists. **This spec rewrites that dialog's copy and buttons** rather than building a new surface.

### 2. Where "edit each post" lives

The cancelled-recoverable flow keeps the wizard editable. Route: **`/posts?batchId={batchId}`**.

- `src/app/(app)/(onboarded)/posts/page.tsx` lines 70–72: when `data.batch.status === "cancelled"`, it renders `<NetworkWizard data={data} mode="cancelled" />` — the same editable wizard used during review, just with cancelled-mode UI affordances.
- The `<UnscheduledBatchCard />` already uses this exact href for its primary action on cancelled cards: `<Link href={\`/posts?batchId=${data.id}\`}>Posts are cancelled, click to reschedule →</Link>` (line 77).

So the dialog's "Edit posts" button is a thin `<Link>` to the same destination. No new route, no new wizard variant.

### 3. How to compute the tier-aware count + next-available date

`subscriptionService.checkSubscription(userId)` (`src/lib/services/subscription-service.ts:152`) returns the full snapshot the page already loads:

```ts
type SubscriptionStateSnapshot = {
  plan: "free_trial" | "starter" | "pro";
  status: "trial" | "active" | "cancelled" | "expired";
  nextResetAt: Date | null;                  // see below
  proQuota: { used: number; max: 4; periodEndsAt: Date } | null;  // Pro only
  daysLeftInTrial: number | null;
  // ...other fields
};
```

The fields we need, per tier:

| Tier | Detected by | Remaining count | Next-available date |
|---|---|---|---|
| Trial | `status === "trial"` (regardless of `plan`) | n/a — trial is 1-batch-lifetime, no rolling window | n/a — upgrade is the only path |
| Starter | `plan === "starter" && status === "active"` | n/a — 1 per rolling 7 days, no "remaining" concept | `snapshot.nextResetAt` (== `lastBatch.createdAt + 7d`; non-null whenever the user is within the 7-day wait, which is exactly when they have a cancelled batch they could try to delete) |
| Pro, slots left | `plan === "pro" && status === "active" && proQuota.used < 4` | `4 - proQuota.used` | n/a — under-cap Pro has no future reset to show |
| Pro, at cap | `plan === "pro" && status === "active" && proQuota.used >= 4` | "all 4 used" (literal) | `proQuota.periodEndsAt` (== `currentPeriodStart + 30d`; same value as `snapshot.nextResetAt` on this branch — `nextResetAt` is sourced from the same `getProQuotaState` call) |

**Soft-delete correctness.** All three numbers stay correct after soft-delete because the tombstone is what the gates count:
- Trial: tombstoned row still satisfies the "any batch exists" check (no `deleted_at` filter on `subscription-service.ts:410–413`).
- Starter: `getMostRecentBatchInternal` (`subscription-service.ts:699–710`) returns the tombstone if it's the newest, so `nextResetAt = tombstone.createdAt + 7d` — the warning's date matches what the user will hit AFTER delete.
- Pro: `getProQuotaState` (`subscription-service.ts:301–335`) counts tombstones, so `proQuota.used` stays unchanged across the delete. "You'll have N of 4 left" is true before and after.

This means **we read these values BEFORE delete from the existing page-level snapshot** — no need to re-fetch after the action, no need to derive from `batch.createdAt` separately.

**Plumbing.** The `/create` page already loads the snapshot. The cleanest path is to derive a small union at the page level and thread it down:

```ts
type DeleteWarning =
  | { tier: "trial" }
  | { tier: "starter"; nextAvailable: Date }
  | { tier: "pro_under_cap"; remaining: number }
  | { tier: "pro_at_cap"; nextAvailable: Date };
```

Pass `warning: DeleteWarning` through `<UnscheduledBatchList />` → `<UnscheduledBatchCard />` → `<DeleteBatchForeverTrigger />` → `<DeleteBatchForeverDialog />`. One round-trip, no client-side service calls, no new server action.

The warning is computed once per page render in `/create/page.tsx` from the already-loaded `subscription` snapshot — see § 4 for the derivation rules.

---

## 1. Dialog rewrite — copy + actions

The existing `<DeleteBatchForeverDialog />` keeps its name, file path, and action wiring (`deleteBatchForeverAction`). What changes:

### Title

Stays Fraunces, `text-2xl tracking-tight font-medium` per DESIGN.md §4. New wording per tier — see § 3 below. Existing title (`"Delete this batch forever?"`) is replaced — the warning is the title now.

### Body

**Warning line first.** Red/destructive tinted, leading the body. Uses the `text-destructive` token + an `AlertCircle` icon (size-5, stroke-1.5) inline. Per DESIGN.md §3 the destructive token is warm coral (peachy in dark, rust in light), not a saturated red — kept inside the gold family.

**Solution line second.** Muted-foreground, `text-base leading-7`. Surfaces the "Instead, you can edit the posts and keep your full set" guidance.

DESIGN.md §14 forbids exclamation points in microcopy. The user-supplied draft uses `"Alert!"` as the opener. **Decision: keep `"Alert"` but drop the exclamation point** — `"Alert —"` reads as the same tonal cue without breaking the brand voice rule. All four variants follow this pattern.

### Buttons

Replaces the current Keep batch / Delete pair with:

- **Edit posts** — primary champagne CTA (`variant="default"`, `rounded-full`, per DESIGN.md §9). Anchored to `<Link href={\`/posts?batchId=${batchId}\`}>` via `asChild`. This is the easy path — kept on the right per DESIGN.md §1 (single primary CTA per surface, right-edge prominence).
- **Delete anyway** — `variant="destructive"`, `rounded-lg`. Sits to the left of the primary. Same handler the current `Delete` button uses (`startTransition` → `deleteBatchForeverAction(batchId)` → success/error toasts).

The dismiss-via-overlay path (clicking outside, pressing Esc) stays intact via shadcn `<Dialog>` default behavior — no explicit "Cancel" button needed; the two buttons are the two paths forward, and the user can always close without choosing.

### Image-preservation copy

The current dialog tells the user `{N} images will move to your Image Library so you can reuse them.` That sentence stays — appended to the solution line as a third tail sentence in muted-foreground, smaller (`text-sm`). The Library-handoff promise is the only reason "Delete anyway" is psychologically tolerable; removing it would make the destructive path feel worse than it is.

---

## 2. Tier-aware copy — final wording

The four variants (with a fifth fallback strand inside Starter — see note). All lead with `Alert —` and end with the solution line. The destructive line is one sentence; the solution line is one or two sentences. Date formatting is the user's browser locale via `Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" })` — same formatter `<QuotaGatedScreen />` already uses in `quota-gated-screen.tsx:204`. Number values are interpolated directly (no localization needed for "1", "2", "3").

### Trial

> **Title:** Delete your trial batch?
>
> **Body:**
> Alert — this is your trial batch. Deleting it won't let you make another.
>
> Upgrade to keep creating posts. {N} images will move to your Image Library.

- Primary CTA: **Upgrade →** (`<Link href="/pricing">`). The trial variant **replaces** the "Edit posts" button with an upgrade CTA — there's no point editing a trial batch the user already cancelled if they can't generate again on trial.
- Secondary CTA: **Delete anyway** (destructive).
- The user-supplied draft says "lead with upgrade" — the title, the warning, AND the primary CTA all push toward upgrade. The destructive action is still available but de-emphasized.

### Starter (active, has a cancelled batch) — date known

> **Title:** Delete this batch?
>
> **Body:**
> Alert — deleting won't free up a new batch. Your next one unlocks on {weekday, Month D} (7 days from creation).
>
> Instead, you can edit the posts and keep your full set. {N} images will move to your Image Library.

- Primary CTA: **Edit posts →** (`<Link href={\`/posts?batchId=${batchId}\`}>`).
- Secondary CTA: **Delete anyway** (destructive).
- Used when the `starter` warning carries a non-null `nextAvailable`.

### Starter / unknown-date fallback (date is null) — NEUTRAL

> **Title:** Delete this batch?
>
> **Body:**
> Alert — deleting won't free up a new batch.
>
> Instead, you can edit the posts and keep your full set. {N} images will move to your Image Library.

- **No date is printed.** The warning is one sentence; the solution sentence follows immediately.
- Primary CTA: **Edit posts →**.
- Secondary CTA: **Delete anyway** (destructive).
- Used when the `starter` warning carries `nextAvailable: null` — which covers the inactive paid-plan branch (`nextResetAt` returns `{ at: null, reason: "inactive" }`) and the defensive Starter-with-no-prior-batch branch. Either way: don't fabricate a date the user can hold us to.

### Pro, under cap (`used < 4`)

> **Title:** Delete this batch?
>
> **Body:**
> Alert — deleting won't give you the slot back. You'll have {4 − used} of 4 batches left this period.
>
> Instead, you can edit the posts and keep your full set. {N} images will move to your Image Library.

- Primary CTA: **Edit posts →**.
- Secondary CTA: **Delete anyway** (destructive).
- Number is `proQuota.max - proQuota.used`. When `proQuota.used = 3`, copy reads `"1 of 4 batches left"`. The "1" is rendered as a digit — DESIGN.md doesn't specify, and the quota screens already use digits.

### Pro, at cap (`used === 4`)

> **Title:** Delete this batch?
>
> **Body:**
> Alert — you've used all 4 batches this period. Deleting won't free up a new one — you won't be able to create another until {weekday, Month D}.
>
> Instead, you can edit the posts. {N} images will move to your Image Library.

- Primary CTA: **Edit posts →**.
- Secondary CTA: **Delete anyway** (destructive).
- Date is `proQuota.periodEndsAt` (== `currentPeriodStart + 30d`). Always non-null on this branch (it's sourced from the Pro proQuota object, which is non-null whenever this variant fires) — no fallback needed.
- The "keep your full set" tail is dropped on this variant — the user already has 4/4 batches, "keep your full set" reads odd next to "you've used all 4." The solution line stays short.

---

## 3. Derivation rules (page-level)

In `src/app/(app)/(onboarded)/create/page.tsx`, after the existing `subscription` and `cards` loads, compute `warning: DeleteWarning` once and pass it down. Only cancelled cards render the trigger, so the warning only matters for cards in `status === "cancelled"` — but it's cheap to compute, so we compute once per page render and pass to every card uniformly (the card decides whether to use it based on its own status, same way it decides whether to render the trigger at all).

The `starter` variant's `nextAvailable` is **explicitly nullable**. A null value means "we don't know the next-available date, so don't print one" — the dialog renders the neutral Starter copy from §2. We never substitute `new Date()` or any other placeholder timestamp; fabricating a date the user can hold us to would be worse than omitting it.

```ts
type DeleteWarning =
  | { tier: "trial" }
  | { tier: "starter"; nextAvailable: Date | null }
  | { tier: "pro_under_cap"; remaining: number }
  | { tier: "pro_at_cap"; nextAvailable: Date };

function deriveDeleteWarning(snapshot: SubscriptionStateSnapshot): DeleteWarning {
  // Trial users — `status === "trial"`. Plan field may still read "free_trial";
  // status is the load-bearing signal (same convention canGenerate uses).
  if (snapshot.status === "trial") {
    return { tier: "trial" };
  }

  // Pro: check both plan and active status. proQuota is non-null exactly when
  // both hold true (snapshot type contract).
  if (snapshot.plan === "pro" && snapshot.proQuota) {
    if (snapshot.proQuota.used >= snapshot.proQuota.max) {
      return { tier: "pro_at_cap", nextAvailable: snapshot.proQuota.periodEndsAt };
    }
    return { tier: "pro_under_cap", remaining: snapshot.proQuota.max - snapshot.proQuota.used };
  }

  // Starter active. `nextResetAt` is non-null when the user is within the
  // 7-day wait — exactly when a cancelled-and-undeletable batch could exist.
  // It IS null on the rare Starter-with-no-prior-batch path; pass null
  // through so the dialog renders the neutral Starter copy.
  if (snapshot.plan === "starter" && snapshot.status === "active") {
    return { tier: "starter", nextAvailable: snapshot.nextResetAt };
  }

  // Inactive paid plans (cancelled/expired Starter or Pro). A cancelled card
  // can still be reachable via a stale deep link, so we still need to render
  // *something* if the dialog opens. `subscriptionService.nextResetAt` returns
  // `{ at: null, reason: "inactive" }` for this branch, so `snapshot.nextResetAt`
  // is null — pass it through. The dialog renders the neutral Starter copy
  // ("Deleting won't free up a new batch. Instead, you can edit the posts...")
  // with no date claim. Don't fabricate a timestamp here.
  return { tier: "starter", nextAvailable: snapshot.nextResetAt };
}
```

**No fifth variant.** The dialog branches on `warning.tier`, and the Starter branch additionally branches on `nextAvailable === null` to pick between the dated and neutral copy in §2. The dated and neutral variants share the same title, the same primary/secondary CTAs, and the same image-preservation tail — the only difference is whether the unlock date is printed.

**Why nullable instead of a sentinel.** A `Date | null` makes the "we don't know" case unmissable at the type level — the dialog can't silently format a placeholder Date as `"December 31, 1969"` if a contributor forgets the null check. The type system enforces the rule the copy depends on.

---

## 4. File-by-file change set (no code — for the implementer)

1. **`src/app/(app)/(onboarded)/create/page.tsx`** — derive `warning` from the existing `subscription` snapshot; pass to `<UnscheduledBatchList />`.

2. **`src/components/create/unscheduled-batch-list.tsx`** — accept `warning: DeleteWarning` prop, forward to every `<UnscheduledBatchCard />`.

3. **`src/components/create/unscheduled-batch-card.tsx`** — accept `warning` prop; forward to `<DeleteBatchForeverTrigger />` when rendering the trigger on cancelled cards. Other batches don't render the trigger at all, so passing `warning` is harmless.

4. **`src/components/create/delete-batch-forever-trigger.tsx`** — accept `warning` prop; forward to `<DeleteBatchForeverDialog />`. Trigger button (`"Delete forever"`) and outer state ownership are unchanged.

5. **`src/components/create/delete-batch-forever-dialog.tsx`** — main work:
   - Accept `warning: DeleteWarning` prop.
   - Switch on `warning.tier` to pick title + body + primary CTA.
   - Replace button row with: primary CTA on the right (Edit posts | Upgrade, depending on tier), destructive "Delete anyway" on the left.
   - Inline `<AlertCircle>` icon on the warning line.
   - Date formatting via `Intl.DateTimeFormat` in `useEffect` / mount-guarded path so the SSR pass renders a generic placeholder ("soon") and the client pass renders the real date — same pattern `<QuotaGatedScreen />`'s `useHasMounted` hook uses (`quota-gated-screen.tsx:90–96`). No new hook needed; copy the existing one.

6. **No service-layer changes.** `subscriptionService.checkSubscription` already exposes everything we need.

7. **No new server action.** The existing `deleteBatchForeverAction` still backs the "Delete anyway" path unchanged.

8. **No schema changes.** Read-only consumption of `subscriptions` columns that already exist.

---

## 5. Out of scope

- **No restyling of `<DeleteBatchForeverTrigger />`** — the button label, color, and position on the card stay exactly as today.
- **No changes to the post-action toast copy.** Success-toast (`"Batch deleted. {N} images saved to your Library."`) and error-toast paths stay as they are in `delete-batch-forever-dialog.tsx:60–71`.
- **No "restore deleted batch" UI.** Soft-deleted is still terminal from the user's perspective — `specs/quota-soft-delete/spec.md` §5 already locks this.
- **No upsell on Starter / Pro variants.** Only the Trial variant pushes upgrade in copy. Starter/Pro variants stay neutral — the goal is to retain them on their current plan by surfacing the edit path, not to upsell.
- **No analytics events.** If we want to measure "Edit posts vs Delete anyway" split, add it as a follow-up — out of scope here.
- **No "are you sure?" double-confirm on Delete anyway.** One confirm dialog with a clear warning is enough; a second dialog reads as nag.

---

## 6. Verification

After the wave ships, manually verify each variant by simulating the four tier states (existing test users / Drizzle Studio plan seeding via `setPlan`, same flow other waves use):

| Variant | Setup | Expected dialog state |
|---|---|---|
| Trial | Trial user, 1 cancelled batch | Title: "Delete your trial batch?"; primary CTA: `Upgrade →` |
| Starter | Starter user, cancelled batch from <7 days ago | Title: "Delete this batch?"; date in warning line matches `lastBatch.createdAt + 7d` rendered in the local timezone |
| Pro under cap | Pro user with `proQuota.used = 2`, one of the 2 is cancelled | Warning reads "2 of 4 batches left this period" |
| Pro at cap | Pro user with `proQuota.used = 4`, ≥1 cancelled | Warning reads "you've used all 4 batches this period"; date matches `periodEndsAt` |

For each variant, click **Delete anyway**, confirm the card disappears from `/create`, then attempt to generate a new batch — the gated screen should appear with the same date the warning showed, proving the soft-delete behavior and the warning date stayed coherent.

Cross-check that the **Edit posts** primary CTA on the three non-trial variants navigates to `/posts?batchId=...` and lands on `<NetworkWizard mode="cancelled" />` (the existing cancelled-recoverable flow).

---

## 7. Notes for the dialog implementer

- The destructive token is **warm coral**, not red (DESIGN.md §3). Use `text-destructive` and `AlertCircle` from Lucide at `strokeWidth={1.5}` (DESIGN.md §10).
- `Edit posts` button is `variant="default"` (champagne pill, `rounded-full`) — primary action. Hero-style `glow-champagne` is NOT applied here; a dialog already has its own focal-arrival treatment (DESIGN.md §9, "soft champagne glow on initial render that fades after 600ms").
- Dates that haven't mounted yet render as `"soon"` per the existing `QuotaVariant` convention — keep the SSR/CSR markup identical to avoid hydration warnings.
- The dialog opens on a cancelled-card click only. There is no other entry point. If you find yourself needing to render this dialog from elsewhere, stop and reconsider — the warning copy is contextual to the cancelled-batch surface.
