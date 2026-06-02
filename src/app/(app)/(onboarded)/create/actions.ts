"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { PostLength } from "@/lib/schema";
import { postService } from "@/lib/services";
import type { GenerateActionState } from "./action-types";

/**
 * Server action backing the `/create` page's generate form (Phase 2 task-07).
 *
 * Lifecycle:
 *   1. Re-resolve the Better Auth session — the (onboarded) layout already
 *      guarantees this, but the action can be hit directly via a fetch from
 *      a stale client, so we re-check.
 *   2. Validate the two fields. Empty / whitespace-only is the only
 *      client-side validation; we trim and require both.
 *   3. Delegate to `postService.generateWeekly`, which handles the trial-cap
 *      gate (D20), the Anthropic call, and the transactional persist.
 *   4. On success, redirect to `/posts?batchId=...` so the page re-renders
 *      against the new batch. On failure, return `{ error }` for the form to
 *      surface inline.
 *
 * The `trial_batch_exists` branch redirects back to `/create` (which then
 * renders the gated screen) rather than returning an error, because the
 * gated UX is the right answer to that error — not an inline banner above
 * a form the user can't successfully submit anyway.
 *
 * `GenerateActionState` and the initial state constant live in
 * `./action-types.ts` because Next.js's `"use server"` directive forbids
 * non-async-function value exports from this file.
 */

export async function generateWeeklyAction(
  _prev: GenerateActionState,
  formData: FormData
): Promise<GenerateActionState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const theme = String(formData.get("theme") ?? "").trim();
  const importantThing = String(formData.get("importantThing") ?? "").trim();

  if (!theme || !importantThing) {
    return { error: "Both fields are required." };
  }

  // Phase 3 task-08: Pro users pick via the segmented control; Starter and
  // trial users get a hidden `"medium"` input. Either way the field is
  // present here; this branch is defensive (a stale or hand-crafted client
  // could omit it).
  const rawPostLength = formData.get("postLength");
  if (
    rawPostLength !== "short" &&
    rawPostLength !== "medium" &&
    rawPostLength !== "long"
  ) {
    return { error: "Pick a post length to continue." };
  }
  const postLength: PostLength = rawPostLength;

  const result = await postService.generateWeekly(session.user.id, {
    theme,
    importantThing,
    postLength,
  });

  if (result.ok) {
    redirect(`/posts?batchId=${result.batchId}`);
  }

  switch (result.error) {
    case "no_profile":
      return {
        error: "Your profile isn't set up yet. Finish onboarding first.",
      };
    case "trial_batch_exists":
    case "weekly_cap_active":
    case "monthly_cap_active":
    case "starter_platforms_overage":
    case "plan_inactive":
      // The page-level gate (server-rendered) normally catches these before
      // the form ever renders. Reaching any of these branches means the gate
      // raced with a generate click; bounce back to `/create` so the gated
      // screen takes over. Task 07 owns the per-reason gated UI.
      redirect("/create");
    case "ai_failed":
      return {
        error: "Couldn't reach the AI service. Try again in a minute.",
      };
    case "db_failed":
      return { error: "Something went wrong saving your posts. Try again." };
  }
}
