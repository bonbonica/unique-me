# Task 07: /create page — hub layout

## Status
not started

## Wave
3

## Description

Convert `/create` from "generate form OR gated screen" into a **hub**: stacked unscheduled-batch cards on top, then the existing form/gated-screen below. Implements the collapse-by-default rule (form starts collapsed when 1+ cards exist, expanded when zero) via a small client wrapper.

The hub title changes from "Create this week's posts" to **"Create Posts"** to match the sidebar label.

## Dependencies

**Depends on:** task-01 (`getUnscheduledBatchesForUser`), task-05 (`UnscheduledBatchCard`), task-06 (`UnscheduledBatchList`).
**Blocks:** task-12 (audit).

## Files to Modify

- `src/app/(app)/(onboarded)/create/page.tsx` (modified) — restructure the render tree.
- `src/components/create/create-hub-form-slot.tsx` (new) — small `"use client"` wrapper that holds the `expanded` state and renders the trigger button + collapsible form.

## Implementation Steps

### 1. Fetch unscheduled cards server-side

In `create/page.tsx`, after the existing session/subscription/profile fetches, add:

```ts
const cards = await postService.getUnscheduledBatchesForUser(session.user.id);
```

This call is read-only and cheap (≤ 4 rows, one indexed query); no caching needed.

### 2. Restructure the gated branches

Today the page returns `<TrialGatedScreen />` or `<QuotaGatedScreen variant=... />` early when gated, and falls through to the form when allowed. Change those early returns into local variables that compose into a single final return:

```tsx
let belowSlot: React.ReactNode;
let canStartNew = false;
let capacityTooltip: string | undefined;

// Existing trial gate
if (subscription.status === "trial") {
  const mostRecent = await postService.getMostRecentBatch(session.user.id);
  if (mostRecent) {
    belowSlot = (
      <TrialGatedScreen
        existingBatchId={mostRecent.id}
        batchStatus={mostRecent.status}
      />
    );
    canStartNew = false;
  }
}

// Existing paid gate
if (!belowSlot) {
  const gate = await subscriptionService.canGenerate(session.user.id);
  if (!gate.allowed) {
    canStartNew = false;
    switch (gate.reason) {
      case "weekly_cap_active":
      case "monthly_cap_active":
        belowSlot = <QuotaGatedScreen ... />;
        capacityTooltip = "You've used all batches this period.";
        break;
      case "starter_platforms_overage":
        belowSlot = <QuotaGatedScreen variant="overage" .../>;
        capacityTooltip = "Reduce your platforms in Settings to continue.";
        break;
      case "plan_inactive":
        belowSlot = <QuotaGatedScreen variant="inactive" />;
        capacityTooltip = "Your plan is inactive.";
        break;
      case "trial_batch_exists":
        // Unreachable; handled by the trial branch above.
        break;
    }
  } else {
    canStartNew = true;
    const profile = await profileService.getProfile(session.user.id);
    // ... compute placeholders as today ...
    belowSlot = (
      <CreateHubFormSlot
        initiallyExpanded={cards.length === 0}
        formProps={{
          themePlaceholder,
          importantThingPlaceholder,
          plan: subscription.plan,
        }}
      />
    );
  }
}
```

### 3. Final return

```tsx
return (
  <div className="max-w-3xl mx-auto space-y-12">
    <header className="space-y-3">
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Create Posts
      </h1>
      {showTrialNote ? <TrialNote daysLeft={daysLeft} /> : null}
    </header>

    {(cards.length > 0 || canStartNew) && (
      <UnscheduledBatchList
        cards={cards}
        hasCapacity={canStartNew}
        capacityTooltip={capacityTooltip}
        startNewBatchSlot={
          canStartNew && cards.length > 0 ? (
            <CreateHubStartNewBatchButton />  // toggles the form below
          ) : undefined
        }
      />
    )}

    {belowSlot}
  </div>
);
```

The `<CreateHubStartNewBatchButton />` and `<CreateHubFormSlot />` are client components that coordinate via a shared context or a simple URL hash (e.g., `#new-batch`). Simplest: pass an ID + use the click handler to scroll-to + expand. Implementation detail; pick the lightest pattern.

### 4. The `<CreateHubFormSlot />` client component

```tsx
"use client";
import { useState } from "react";
import { GenerateForm } from "./generate-form";

export function CreateHubFormSlot({
  initiallyExpanded,
  formProps,
}: {
  initiallyExpanded: boolean;
  formProps: ComponentProps<typeof GenerateForm>;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="..."  // muted-foreground link styling
      >
        Show the new-batch form
      </button>
    );
  }

  return <GenerateForm {...formProps} />;
}
```

The collapsed-state fallback button is a polite affordance for users who skipped the `[Start new batch]` button at the top. It's optional; if the design feels cleaner without it (page just shows cards, no form), drop it. Task-13 verification will catch the regression if so.

**Recommended (cleaner)**: omit the collapsed fallback button. When 1+ cards exist, the form is hidden until the user clicks `[Start new batch]` at the top. That button is in the list controls; clicking it toggles the form via a shared client context (`<CreateHubContext>`).

### 5. Drop the old "Create this week's posts" copy + subtitle

The old header had:

```
<h1>Create this week's posts</h1>
<p>We'll write 7 posts for Facebook this week. Pro users also get matching Instagram and LinkedIn versions of each.</p>
```

The subtitle moves *inside* `<GenerateForm />` (or stays as the form's own description) so the hub header is clean: just `"Create Posts"` + the optional `<TrialNote />`.

### 6. Preserve the trial-note

`<TrialNote />` still renders when `subscription.status === "trial" && daysLeft > 0`. Keep its placement in the header.

## Acceptance Criteria

- [ ] `/create` renders `"Create Posts"` h1 (Fraunces).
- [ ] When 1+ unscheduled batches exist: `<UnscheduledBatchList />` renders above the form/gated screen. Form is collapsed.
- [ ] When 0 unscheduled batches exist + capacity available: `<UnscheduledBatchList />` is hidden (returns null), `<GenerateForm />` expanded by default.
- [ ] When gated: `<UnscheduledBatchList />` still shows existing cards (for `cancelled` trial users), the `[Start new batch]` button is disabled with the right tooltip, the appropriate `<QuotaGatedScreen>` or `<TrialGatedScreen />` renders below.
- [ ] All existing gate branches (`trial_batch_exists`, `weekly_cap_active`, `monthly_cap_active`, `starter_platforms_overage`, `plan_inactive`) are preserved.
- [ ] `<TrialNote />` still renders in trial when applicable.
- [ ] No regression to placeholder personalization (`computeThemePlaceholder` / `computeImportantThingPlaceholder`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The page-level data fetches now include `getUnscheduledBatchesForUser` — one extra DB call. Acceptable: server-rendered, cheap query.
- The `monthly_cap_active` arm currently uses the same `variant="quota"` as `weekly_cap_active` (per Phase 4 task-13 comment in the current file). This task should preserve that arm; if Phase 4 task-13 has separately introduced `variant="monthly_quota"`, use that. **Check the current state of the file before editing**.
- The optional collapsed-state fallback button is a judgment call. If the design lead prefers a clean "cards only" view when the form is collapsed, omit it.

## Out of scope

- Server-rendering the form (form stays as the existing client component).
- A modal / drawer for the new-batch flow. Form stays inline-sibling below the list.
- URL hash routing for the form expand state.
- Loading skeleton for the unscheduled batches list (server-rendered, instant).
