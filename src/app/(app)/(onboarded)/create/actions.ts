"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { postingDaysOrFallback } from "@/lib/scheduling/batch-calendar";
import type { PostLength } from "@/lib/schema";
import {
  postService,
  profileService,
  subscriptionService,
} from "@/lib/services";
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
 *   4. On success, redirect to `/schedule-posts/...` so the user lands
 *      directly in the per-batch review view for the new batch (path-
 *      based segment per the navigation redesign). On failure, return
 *      `{ error }` for the form to surface inline.
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

  // Onboarding-posting-preferences wave 3: load the user's profile here so we
  // can pass their preferred posting_days into generateWeekly below. Failing
  // fast on no-profile mirrors the `no_profile` branch returned by the
  // service — generating posts without a profile is impossible, so there's
  // no behaviour change for that edge case.
  const profile = await profileService.getProfile(session.user.id);
  if (!profile) {
    return {
      error: "Your profile isn't set up yet. Finish onboarding first.",
    };
  }

  const theme = String(formData.get("theme") ?? "").trim();
  const importantThing = String(formData.get("importantThing") ?? "").trim();

  if (!theme || !importantThing) {
    return { error: "Both fields are required." };
  }

  // Phase 3 task-08: Pro users pick via the segmented control; Starter and
  // trial users get a hidden `"medium"` input. Either way the field is
  // present here; this branch is defensive (a stale or hand-crafted client
  // could omit it). Onboarding-posting-preferences wave 1: "mix" is added
  // to the accepted set as a typecheck-visible breadcrumb. Wave 2 wires
  // the picker UI; until then no client submits "mix".
  const rawPostLength = formData.get("postLength");
  if (
    rawPostLength !== "short" &&
    rawPostLength !== "medium" &&
    rawPostLength !== "long" &&
    rawPostLength !== "mix"
  ) {
    return { error: "Pick a post length to continue." };
  }
  const postLength: PostLength = rawPostLength;

  // Phase 4 task-12: derive the Pro batch ordinal + postCount server-side.
  // `proQuota.used` is the count BEFORE this insert, so the new batch's
  // ordinal is `used + 1`. Non-Pro plans expose `proQuota === null` and so
  // pass `batchOrdinalInPeriod: null` + the 7-post default. Only ordinal 4
  // — the final Pro batch in a 30-day period — generates 9 posts.
  //
  // Race note: a sibling tab could insert between this snapshot read and
  // the service's own gate re-check, mis-recording the ordinal column.
  // Phase 4 Section A accepts that risk given low expected concurrency;
  // the downstream gate inside `generateWeekly` still blocks an actual
  // 5th batch from landing.
  const snapshot = await subscriptionService.checkSubscription(session.user.id);
  const batchOrdinalInPeriod =
    snapshot.plan === "pro" && snapshot.proQuota
      ? snapshot.proQuota.used + 1
      : null;
  const postCount: 7 | 9 = batchOrdinalInPeriod === 4 ? 9 : 7;

  const result = await postService.generateWeekly(session.user.id, {
    theme,
    importantThing,
    postLength,
    postCount,
    batchOrdinalInPeriod,
    // Onboarding-posting-preferences wave 3: profile.postingDays is the live
    // user preference. NULL on legacy rows reads as "every_day" via the
    // fallback helper. `dayWindow` is the calendar span (always 7 except Pro
    // batch 4 which gets 9); `resolveBatchPlan` inside generateWeekly filters
    // the span by posting_days to produce the actual post count.
    dayWindow: postCount,
    postingDays: postingDaysOrFallback({ postingDays: profile.postingDays }),
  });

  if (result.ok) {
    redirect(`/schedule-posts/${result.batchId}`);
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

/**
 * Server action backing `<DeleteBatchForeverDialog />` (Stage-2 task-08,
 * D-S2-8). Thin wrapper around `postService.deleteBatchForever`:
 *
 *   1. Re-resolves the Better Auth session — the (onboarded) layout already
 *      guarantees this on the page render, but the action can be hit
 *      directly via a stale-client fetch, so we re-check.
 *   2. Delegates to the service, which owns the ownership + status guard,
 *      the image-preservation handoff to `imageService.retainImagesToLibrary`,
 *      and the cascading DELETE on `weekly_batches`.
 *   3. On success, revalidates `/create` so the now-deleted card disappears
 *      from the unscheduled-batches list.
 *
 * The service return shape today is `{ ok: true }` (no `imageCount`) — the
 * dialog falls back to its prop-passed `imageCount` for the success-toast
 * count. Service errors map 1:1 to the union surfaced here; `db_failed`
 * collapses into the dialog's generic-error toast path.
 *
 * Unlike `generateWeeklyAction`, unauthenticated callers get a structured
 * `{ ok: false, error: 'unauthenticated' }` rather than a redirect — the
 * caller is a dialog inside a long-lived page, not a form submit, so a
 * redirect mid-transition would jank the UI. The dialog can choose its
 * surface (currently: collapsed into the generic toast).
 */
export async function deleteBatchForeverAction(
  batchId: string,
): Promise<
  | { ok: true }
  | {
      ok: false;
      error:
        | "unauthenticated"
        | "not_found"
        | "not_owned"
        | "not_cancelled"
        | "db_failed";
    }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await postService.deleteBatchForever(session.user.id, batchId);
  if (!result.ok) return result;

  revalidatePath("/create");
  return { ok: true };
}
