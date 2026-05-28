"use client";

import { useActionState } from "react";
import {
  type GenerateActionState,
  INITIAL_GENERATE_STATE,
} from "@/app/(app)/(onboarded)/create/action-types";
import { generateWeeklyAction } from "@/app/(app)/(onboarded)/create/actions";
import { GeneratingState } from "@/components/create/generating-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Two-field generate form for `/create` (Phase 2 task-07). Posts directly
 * to {@link generateWeeklyAction} via React 19's `useActionState`. On
 * success the action server-side-redirects to `/posts?batchId=...`, so the
 * form never sees an `ok: true` state — only error states surface here.
 *
 * While the action is in flight (`pending`), the entire form is replaced
 * by {@link GeneratingState}. This solves two problems at once:
 *   - The user can't accidentally trigger Generate twice (the form is gone).
 *   - The 60-120s wait gets a real loading surface — spinner, rotating
 *     copy, progress bar — instead of looking like the page froze.
 *
 * On error the form re-renders with the typed values preserved and an
 * inline banner showing the action's error copy.
 */
export function GenerateForm() {
  const [state, formAction, pending] = useActionState<
    GenerateActionState,
    FormData
  >(generateWeeklyAction, INITIAL_GENERATE_STATE);

  if (pending) {
    return <GeneratingState />;
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <div>
        <Label htmlFor="theme" className="mb-2">
          What&apos;s your theme this week?
        </Label>
        <Input
          id="theme"
          name="theme"
          type="text"
          required
          placeholder="e.g. protein basics, autumn florals, holiday gift cards"
          className="h-11 bg-muted"
          aria-invalid={Boolean(state.error) || undefined}
        />
      </div>

      <div>
        <Label htmlFor="importantThing" className="mb-2">
          What&apos;s the important thing you want to highlight?
        </Label>
        <Textarea
          id="importantThing"
          name="importantThing"
          required
          rows={4}
          placeholder="e.g. how to balance protein across meals; the new winter bouquet line; our gift voucher deadline"
          className="min-h-24 bg-muted"
          aria-invalid={Boolean(state.error) || undefined}
        />
      </div>

      {state.error ? (
        <div
          role="alert"
          className="p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm"
        >
          {state.error}
        </div>
      ) : null}

      <Button
        type="submit"
        size="lg"
        className="w-full sm:w-auto rounded-full glow-champagne"
      >
        Generate this week
      </Button>
    </form>
  );
}
