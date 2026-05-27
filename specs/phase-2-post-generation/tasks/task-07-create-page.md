# Task 07: /create Page — Form + Gated Mode + Trial Note

## Status
not started

## Wave
4

## Description

Replace the `/create` "Coming soon" placeholder with the real form (theme + important thing) for users who can generate, plus the `<TrialGatedScreen />` for trial users who already used their batch. Wire the server action that calls `postService.generateWeekly`.

## Dependencies

**Depends on:** task-03 (`generateWeekly`, `hasAnyBatch`, `canGenerate`)
**Blocks:** task-14 (audit)
**Context from dependencies:** `postService.generateWeekly(userId, input): Promise<GenerateWeeklyResult>`, `postService.hasAnyBatch(userId): Promise<boolean>`, `subscriptionService.checkSubscription(userId)`, `subscriptionService.canGenerate(userId)`.

## Files to Modify / Create

- `src/app/(app)/(onboarded)/create/page.tsx` — REPLACE existing "Coming soon" placeholder
- `src/app/(app)/(onboarded)/create/actions.ts` — NEW server action
- `src/components/create/generate-form.tsx` — NEW
- `src/components/create/trial-note.tsx` — NEW (the in-page note, not the TopBar strip)
- `src/components/create/trial-gated-screen.tsx` — NEW

## Implementation Steps

### 1. `src/app/(app)/(onboarded)/create/page.tsx`

Server component. Load session, subscription, and existing-batch status. Branch render:

```tsx
export default async function CreatePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null; // (onboarded) layout should redirect, but be defensive

  const subscription = await subscriptionService.checkSubscription(session.user.id);

  // Gated-mode check (D20)
  if (subscription.status === "trial") {
    const hasBatch = await postService.hasAnyBatch(session.user.id);
    if (hasBatch) {
      const currentBatch = await postService.getCurrentBatch(session.user.id);
      return <TrialGatedScreen existingBatchId={currentBatch?.id ?? null} />;
    }
  }

  const daysLeft = subscription.daysLeftInTrial;

  return (
    <div className="max-w-2xl mx-auto">
      <header className="space-y-3">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Create this week&apos;s posts
        </h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll write 7 posts for Facebook this week. Pro users also get matching
          Instagram and LinkedIn versions of each.
        </p>
        {subscription.status === "trial" && daysLeft !== null && (
          <TrialNote daysLeft={daysLeft} />
        )}
      </header>

      <div className="mt-10">
        <GenerateForm action={generateWeeklyAction} />
      </div>
    </div>
  );
}
```

### 2. `src/app/(app)/(onboarded)/create/actions.ts`

```ts
"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

type GenerateActionState = { error?: string };

export async function generateWeeklyAction(
  _prev: GenerateActionState,
  formData: FormData
): Promise<GenerateActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const theme = String(formData.get("theme") ?? "").trim();
  const importantThing = String(formData.get("importantThing") ?? "").trim();

  if (!theme || !importantThing) {
    return { error: "Both fields are required." };
  }

  const result = await postService.generateWeekly(session.user.id, { theme, importantThing });

  if (result.ok) {
    redirect(`/posts?batchId=${result.batchId}`);
  }

  // Map errors to user-facing copy
  switch (result.error) {
    case "no_profile":
      return { error: "Your profile isn't set up yet. Finish onboarding first." };
    case "trial_batch_exists":
      // Belt-and-braces (page-level gate should have caught this). Redirect to gated screen.
      redirect("/create");
    case "ai_failed":
      return { error: "Couldn't reach the AI service. Try again in a minute." };
    case "db_failed":
      return { error: "Something went wrong saving your posts. Try again." };
  }
}
```

Use React's `useActionState` (or `useFormState` if on older RSC version) in `<GenerateForm />`.

### 3. `<GenerateForm />`

```tsx
"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function GenerateForm({ action }: { action: GenerateAction }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-6">
      <div>
        <Label htmlFor="theme">What&apos;s your theme this week?</Label>
        <Input
          id="theme"
          name="theme"
          placeholder="e.g. protein basics, autumn florals, holiday gift cards"
          required
          className="mt-2"
        />
      </div>

      <div>
        <Label htmlFor="importantThing">What&apos;s the important thing you want to highlight?</Label>
        <Textarea
          id="importantThing"
          name="importantThing"
          placeholder="e.g. how to balance protein across meals; the new winter bouquet line; our gift voucher deadline"
          required
          rows={4}
          className="mt-2"
        />
      </div>

      {state.error && (
        <div role="alert" className="text-destructive text-sm">{state.error}</div>
      )}

      <Button
        type="submit"
        size="lg"
        className="rounded-full glow-champagne w-full sm:w-auto"
        disabled={pending}
      >
        {pending ? "Generating..." : "Generate this week"}
      </Button>
    </form>
  );
}
```

### 4. `<TrialNote daysLeft={N} />`

```tsx
export function TrialNote({ daysLeft }: { daysLeft: number }) {
  return (
    <p className="text-sm text-muted-foreground">
      You&apos;re trying Pro features free for {daysLeft} more {daysLeft === 1 ? "day" : "days"}.
    </p>
  );
}
```

### 5. `<TrialGatedScreen existingBatchId />`

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function TrialGatedScreen({ existingBatchId }: { existingBatchId: string | null }) {
  return (
    <div className="max-w-md mx-auto text-center mt-16 space-y-6">
      <h1 className="font-fraunces text-3xl tracking-tight font-medium">
        You&apos;ve used your trial batch
      </h1>
      <p className="text-base text-muted-foreground leading-7">
        Your 7-day Pro trial includes one batch of 7 posts. Upgrade to keep creating.
      </p>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="rounded-full glow-champagne">
          <Link href="/pricing">See plans</Link>
        </Button>
        {existingBatchId && (
          <Button asChild variant="ghost">
            <Link href={`/posts?batchId=${existingBatchId}`}>
              Review the batch you made →
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
```

`/pricing` is a placeholder route until Phase 4 — for Phase 2, either let the link 404 (acceptable, document) or create a minimal `src/app/pricing/page.tsx` saying "Pricing page coming soon." Decide with the user before implementation; recommended: minimal placeholder page.

## Acceptance Criteria

- [ ] Trial user with NO batch sees the form + `<TrialNote />`
- [ ] Trial user with ANY batch (any status) sees `<TrialGatedScreen />`
- [ ] Non-trial user (`active`, `cancelled`, `expired`) sees the form (no trial note)
- [ ] Submit calls `generateWeeklyAction` → on success redirects to `/posts?batchId=...`
- [ ] All four `GenerateWeeklyResult` error variants render the right copy
- [ ] Generate button shows pending state during action call
- [ ] Form validation: both fields required, trimmed
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` clean

## Notes

- `(onboarded)` layout already redirects unauthenticated users — the `if (!session)` guard is defensive.
- The trial banner in `DashboardTopBar` (task-13) is separate; do NOT duplicate it inside `/create` when in gated mode. The TopBar strip is enough on the gated screen.
- Keep the form mobile-first: the explainer + form must fit within `max-w-2xl` and be touch-friendly.
