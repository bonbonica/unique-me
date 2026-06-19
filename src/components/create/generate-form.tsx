"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
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
import type { PostLength } from "@/lib/schema";
import { cn } from "@/lib/utils";

/**
 * Two-field generate form for `/create` (Phase 2 task-07 + polish wave).
 * Posts directly to {@link generateWeeklyAction} via React 19's
 * `useActionState`. On success the action server-side-redirects to
 * `/posts?batchId=...`, so the form never sees an `ok: true` state — only
 * error states surface here.
 *
 * Placeholders are passed in from the server (computed from the user's
 * profile — see `/create/page.tsx`) so they feel personal to the user's
 * actual business rather than generic florist/nutritionist examples.
 *
 * While the action is in flight (`pending`), the entire form is replaced
 * by {@link GeneratingState}. This solves two problems at once:
 *   - The user can't accidentally trigger Generate twice (the form is gone).
 *   - The 60-120s wait gets a real loading surface — spinner, rotating
 *     copy, progress bar — instead of looking like the page froze.
 *
 * On error the form re-renders with the typed values preserved and an
 * inline banner showing the action's error copy.
 *
 * Phase 3 task-08: users with Pro feature access get a required
 * Short/Medium/Long segmented control (no default — forces an explicit
 * choice per D7). Other users don't see the picker; the form submits
 * `postLength="medium"` via a hidden input so the action and service always
 * receive a value. Active trial users are treated as Pro for feature access
 * via `hasProFeatures` resolved server-side by the page caller.
 */
export function GenerateForm({
  themePlaceholder,
  importantThingPlaceholder,
  hasProFeatures,
}: {
  themePlaceholder: string;
  importantThingPlaceholder: string;
  hasProFeatures: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    GenerateActionState,
    FormData
  >(generateWeeklyAction, INITIAL_GENERATE_STATE);

  // Only Pro-feature users see the picker. Mix is preselected for everyone
  // (spec §6) so the submit button never needs a null-gate — length always
  // has a value.
  const [postLength, setPostLength] = useState<PostLength>("mix");
  const isPro = hasProFeatures;

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
          placeholder={themePlaceholder}
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
          placeholder={importantThingPlaceholder}
          className="min-h-24 bg-muted"
          aria-invalid={Boolean(state.error) || undefined}
        />
      </div>

      {isPro ? (
        <PostLengthPicker value={postLength} onChange={setPostLength} />
      ) : (
        <input type="hidden" name="postLength" value="mix" />
      )}

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
        {pending ? (
          <>
            <Loader2 className="animate-spin size-4 mr-2" aria-hidden />
            Creating posts…
          </>
        ) : (
          "Create new posts"
        )}
      </Button>
    </form>
  );
}

// =============================================================================
// Post-length picker (Pro-only)
// =============================================================================

const POST_LENGTH_OPTIONS: ReadonlyArray<{
  value: PostLength;
  label: string;
  // Marks the recommended option. Only ever true for "mix" in v1.
  recommended?: boolean;
}> = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
  { value: "mix", label: "Mix", recommended: true },
];

/**
 * Segmented control built on native `<input type="radio">` so arrow-key
 * navigation and form submission Just Work. The visible "pill" is the
 * `<span>` inside each `<label>`; the input itself is visually hidden
 * (`sr-only`) but remains focusable, which is what `peer-focus-visible`
 * keys off for the focus ring.
 */
function PostLengthPicker({
  value,
  onChange,
}: {
  value: PostLength;
  onChange: (next: PostLength) => void;
}) {
  return (
    <div>
      <span
        id="post-length-label"
        className="block text-sm font-medium mb-2"
      >
        Post length
      </span>
      <div
        role="radiogroup"
        aria-required="true"
        aria-labelledby="post-length-label"
        className="inline-flex rounded-full bg-muted p-1 border border-border"
      >
        {POST_LENGTH_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              className="relative cursor-pointer"
            >
              <input
                type="radio"
                name="postLength"
                value={option.value}
                required
                checked={selected}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "block px-5 py-2 rounded-full text-sm font-medium transition-colors duration-200",
                  "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/30 peer-focus-visible:outline-none",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent/40"
                )}
              >
                {option.label}
                {option.recommended ? (
                  <span className="ml-1.5 text-xs opacity-70">
                    (Recommended)
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Short = scroll-stopper · Medium = conversational · Long = storytelling ·
        Mix = a balanced rotation.
      </p>
    </div>
  );
}
