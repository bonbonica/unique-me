# Task 08: /posts Wizard Skeleton — Page + NetworkWizard + WizardNav

## Status
not started

## Wave
4

## Description

Replace the `/posts` "Coming soon" placeholder with a server component that loads the batch and branches by `batch.status` into the wizard, the locked summary, or an error redirect. Build `<NetworkWizard />` orchestrator (step-index state, child component selector based on current step) and `<WizardNav />` (Back / Next / on-summary-step replaced). Step content components (`<WizardStep />`, `<WizardSummary />`, `<LockedSummary />`) come in tasks 09–11.

## Dependencies

**Depends on:** task-01 (schema), task-06 (`profile.platforms` reliably populated)
**Blocks:** task-09, task-10
**Context from dependencies:** `postService.getBatchForReview(batchId, userId): Promise<BatchForReview | null>` and `postService.getCurrentBatch(userId): Promise<WeeklyBatch | null>` from task-05.

## Files to Modify / Create

- `src/app/(app)/(onboarded)/posts/page.tsx` — REPLACE placeholder
- `src/app/(app)/(onboarded)/posts/actions.ts` — NEW (server actions for selection/edit/regen/schedule/stop; some called by tasks 09/10/11)
- `src/components/posts/network-wizard.tsx` — NEW orchestrator
- `src/components/posts/wizard-nav.tsx` — NEW Back/Next nav

## Implementation Steps

### 1. `src/app/(app)/(onboarded)/posts/page.tsx`

Server component. Load batch (from `batchId` query param or `getCurrentBatch`). Branch by status:

```tsx
type SearchParams = Promise<{ batchId?: string }>;

export default async function PostsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const { batchId: paramBatchId } = await searchParams;

  // Resolve which batch to show
  let batchId = paramBatchId;
  if (!batchId) {
    const current = await postService.getCurrentBatch(session.user.id);
    if (!current) redirect("/create");
    batchId = current.id;
  }

  const data = await postService.getBatchForReview(batchId, session.user.id);
  if (!data) redirect("/create");

  // Defensive: empty platforms array means onboarding never wrote it
  if (data.platforms.length === 0) {
    redirect("/onboarding");
  }

  switch (data.batch.status) {
    case "reviewing":
      return <NetworkWizard data={data} />;
    case "scheduling":
    case "cancelled":
      return <LockedSummary data={data} />;
    case "scheduled":
    case "completed":
      // Phase 4 will render these states. For Phase 2 redirect.
      redirect("/dashboard");
    case "in_progress":
      // Stale state — shouldn't happen with current code paths
      redirect("/create");
  }
}
```

### 2. `src/components/posts/network-wizard.tsx`

Client component. Holds the current step index. Step list = `data.platforms` in canonical order `[facebook, instagram, linkedin]` (filtered) + a synthetic `"summary"` final step.

```tsx
"use client";

import { useState } from "react";
import type { BatchForReview, SelectionPlatform } from "@/lib/schema";
import { WizardStep } from "./wizard-step";
import { WizardSummary } from "./wizard-summary";
import { WizardNav } from "./wizard-nav";

const PLATFORM_ORDER: SelectionPlatform[] = ["facebook", "instagram", "linkedin"];

export function NetworkWizard({ data }: { data: BatchForReview }) {
  const platforms = PLATFORM_ORDER.filter((p) => data.platforms.includes(p));
  const totalSteps = platforms.length + 1;

  const [stepIndex, setStepIndex] = useState(0);
  const isSummary = stepIndex === platforms.length;
  const currentPlatform = isSummary ? null : platforms[stepIndex]!;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <WizardHeader
        batch={data.batch}
        currentStep={stepIndex + 1}
        totalSteps={totalSteps}
        platforms={platforms}
      />

      {!isSummary && currentPlatform && (
        <WizardStep
          platform={currentPlatform}
          posts={data.posts}
          batchTheme={data.batch.theme}
        />
      )}

      {isSummary && (
        <WizardSummary
          batch={data.batch}
          posts={data.posts}
          platforms={platforms}
        />
      )}

      <WizardNav
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        isSummary={isSummary}
        onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
        onNext={() => setStepIndex((i) => Math.min(totalSteps - 1, i + 1))}
      />
    </div>
  );
}
```

`<WizardHeader>` is inline or a tiny extracted component — renders the batch theme/important_thing summary + step counter + progress dots.

**State decision:** local React state (`useState`) for step index. Selections persist via DB (post_selections table), not local state, so navigating back-and-forth re-reads from `data.posts` which the page fetched. If the user toggles a checkbox, the server action mutates the DB but the page-level fetched data is stale until next navigation. For Phase 2 that's acceptable — each network step renders from the initial fetch + tracks local optimistic state inside `<WizardStep />`. Task-09 owns that optimistic-state pattern.

### 3. `src/components/posts/wizard-nav.tsx`

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";

export function WizardNav({
  stepIndex,
  totalSteps,
  isSummary,
  onBack,
  onNext,
}: {
  stepIndex: number;
  totalSteps: number;
  isSummary: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border pt-6">
      <Button
        variant="ghost"
        onClick={onBack}
        disabled={stepIndex === 0}
      >
        <ArrowLeft className="size-4 mr-2" />
        Back
      </Button>

      {!isSummary && (
        <Button onClick={onNext}>
          Next
          <ArrowRight className="size-4 ml-2" />
        </Button>
      )}
      {/* Summary step has its own "Schedule my pick" button — rendered inside <WizardSummary />, not here */}
    </div>
  );
}
```

### 4. `src/app/(app)/(onboarded)/posts/actions.ts`

Skeleton file with all the server-action exports the wizard pieces will use. Each action is implemented in its specific task; this file exists so wizard components have stable imports.

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";
import type { SelectionPlatform } from "@/lib/schema";

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

// Implemented in task-09:
export async function selectForNetworkAction(postId: string, platform: SelectionPlatform) {
  const session = await requireSession();
  return await postService.selectForNetwork(postId, session.user.id, platform);
}

export async function deselectForNetworkAction(postId: string, platform: SelectionPlatform) {
  const session = await requireSession();
  return await postService.deselectForNetwork(postId, session.user.id, platform);
}

// Implemented in task-12 (via dialogs but action exported here):
export async function updatePostAction(
  postId: string,
  updates: { postText?: string; hashtags?: string[] }
) {
  const session = await requireSession();
  return await postService.update(postId, session.user.id, updates);
}

export async function regeneratePostAction(postId: string, feedback: string) {
  const session = await requireSession();
  return await postService.regenerate(postId, session.user.id, feedback);
}

// Implemented in task-10:
export async function scheduleMyPickAction(batchId: string) {
  const session = await requireSession();
  return await postService.scheduleMyPick(batchId, session.user.id);
}

// Implemented in task-11:
export async function stopBatchAction(batchId: string) {
  const session = await requireSession();
  return await postService.stopBatch(batchId, session.user.id);
}
```

## Acceptance Criteria

- [ ] `/posts` server component loads batch and branches by status
- [ ] `/posts?batchId=X` with X owned by session user loads correctly
- [ ] `/posts?batchId=X` with X NOT owned by session user redirects to `/create`
- [ ] `/posts` with no query param uses `getCurrentBatch` — redirects to `/create` if none
- [ ] `platforms.length === 0` redirects to `/onboarding` (defensive)
- [ ] `<NetworkWizard />` renders correct step count: `platforms.length + 1`
- [ ] `<WizardNav />` Back is disabled on step 1
- [ ] `<WizardNav />` Next is hidden on the summary step (only Back remains visible there)
- [ ] All server actions in `actions.ts` are exported and re-call session
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` clean

## Notes

- Step content for non-summary steps comes from task-09. For task-08 only, render a stub like `<div>Wizard step for {platform} — task-09</div>` so the skeleton compiles before task-09 lands.
- Same for `<WizardSummary />` (task-10) and `<LockedSummary />` (task-11) — stub them.
- Server actions in `actions.ts` are just thin wrappers around `postService.*`. The server-side enforcement lives in the service layer.
