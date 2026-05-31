# Task 08: GenerateForm — Pro-Only Post-Length Picker

## Status
not started

## Wave
3

## Description

Add a Pro-only post-length picker to `<GenerateForm />`. Pro users see a segmented control: **Short · Medium · Long**, required, no default preselection. Starter and trial users don't see the picker; the form submits `postLength="medium"` via a hidden input so the action and service always receive a value.

## Dependencies

**Depends on:** task-06 (`generateWeeklyAction` + `postService.generateWeekly` accept `postLength`), task-07 (form is rendered inside the create page's gated-branch tree)
**Blocks:** none
**Context from dependencies:** task-06 makes `postLength` a required field on the action's FormData payload; task-07 provides the page-level structure.

## Files to Modify

- `src/components/create/generate-form.tsx` (modified) — add picker + hidden fallback
- `src/app/(app)/(onboarded)/create/page.tsx` (modified) — pass `subscription.plan` prop to `<GenerateForm />`
- `src/app/(app)/(onboarded)/create/actions.ts` (modified) — read `postLength` from FormData, validate, pass to service

## Implementation Steps

### 1. Form component

- New prop: `plan: SubscriptionPlan`.
- If `plan === "pro"`: render a segmented control / radio group with 3 options. Required. No default checked. Submitted name: `postLength`.
- If `plan !== "pro"`: render `<input type="hidden" name="postLength" value="medium" />`.
- Disable the Generate button until a `postLength` is selected (Pro) or always enabled (Starter/Trial — hidden input is always set).

### 2. Picker styling (design system)

- Use a segmented-control look: 3 connected pills inside a `rounded-full` container, champagne fill on the selected option, ivory on unselected. Match the brand's "single primary, restrained color" aesthetic.
- Label above: "Post length" — Geist sans, `text-sm font-medium`, `mb-2`.
- Sub-label below picker (optional): "Short = scroll-stopper · Medium = conversational · Long = storytelling." (small, `text-muted-foreground`).

### 3. Page integration

- `create/page.tsx` already calls `checkSubscription(session.user.id)` for the trial-gate logic. Pass `subscription.plan` down to `<GenerateForm plan={subscription.plan} ... />`.

### 4. Action update

- In `create/actions.ts`, read `postLength` from FormData. Validate it's one of `"short" | "medium" | "long"`. If invalid or missing, return the existing `{ error }` shape with "Pick a post length to continue." (defensive — the form prevents submission).
- Pass `postLength` through to `postService.generateWeekly({ theme, importantThing, postLength })`.

### 5. Accessibility

- `role="radiogroup"` on the segmented control wrapper.
- `aria-required="true"`.
- Each option `<input type="radio" name="postLength" value="...">` paired with a `<label>`.
- Keyboard nav: arrow keys move between options (standard radio-group behavior).

## Acceptance Criteria

- [ ] Pro user sees the picker; Starter and trial users do not (verified via `setPlan` Drizzle Studio dance).
- [ ] Pro user can't submit without picking a length (button disabled until selection).
- [ ] Starter/trial user submits successfully — hidden input carries `"medium"`.
- [ ] Action persists the chosen length to `weekly_batches.post_length` (Drizzle Studio verification).
- [ ] AI output reflects the length choice (eyeball: long generates noticeably longer captions than short).
- [ ] Keyboard nav works on the segmented control.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- "No default preselection on Pro" is a deliberate UX choice — forces the user to confirm they want a specific length, avoiding accidental "medium" submissions that don't reflect their intent.
- Don't render the sub-label as Fraunces. UI text is Geist (per DESIGN.md § 4 heading rule).
- The picker is per-batch (D7) — don't cache the last selection across batches. Phase 4+ may revisit this if users complain.
