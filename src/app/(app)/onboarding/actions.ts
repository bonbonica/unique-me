"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { BUSINESS_TYPES } from "@/lib/profile/constants";
import { checkContentPolicy } from "@/lib/profile/content-policy";
import { setHasProfileCookie } from "@/lib/profile/cookie";
import { type WebsiteAnalysis } from "@/lib/schema";
import { profileService, subscriptionService } from "@/lib/services";
import { type SaveProfileInput } from "@/lib/services/profile-service";

/**
 * Server action for the onboarding form (Phase 1, spec § 1.4).
 *
 * Lifecycle (in order, all on the server):
 *   1. Authenticate via Better Auth session.
 *   2. Parse + validate the FormData with a UI-specific Zod schema. This
 *      mirrors `saveProfileSchema` from the service layer but adds the
 *      UI-only `hasNoWebsite` checkbox and accepts `business_*` snake_case
 *      field names from the form.
 *   3. Run the content-policy check on the description + type.
 *   4. Optionally scrape + analyze the website (best-effort — failures are
 *      saved as `websiteAnalysis: null` rather than blocking onboarding).
 *   5. Upsert the profile row.
 *   6. Start the trial (idempotent — the Better Auth user-create hook may
 *      have already inserted a row).
 *   7. Set the `uniqueme:has-profile=1` cookie that the proxy reads to gate
 *      future protected routes.
 *
 * The action returns `{ ok: true, redirectTo }` on success. The client form
 * uses `useActionState` and performs the redirect via `router.replace` so we
 * don't need to throw a `redirect()` here — keeping the action's return
 * shape uniform makes the form's success/error handling simpler.
 */

export type OnboardingState =
  | { ok: false; error?: string; fieldErrors?: Record<string, string> }
  | { ok: true; redirectTo: string };

/**
 * Return shape of {@link analyzeWebsiteAction}. The client component holds
 * the resulting `analysis` object in state and forwards it back to
 * {@link saveOnboardingAction} via hidden form inputs so we don't re-scrape
 * on submit when the URL is unchanged.
 *
 * The failure reasons are surfaced as a discriminated union so the form can
 * pick the right tone of voice for each case (soft fallback hints, not
 * banner errors — the user can still fill the description manually).
 */
export type WebsiteAnalysisResult =
  | {
      ok: true;
      analysis: WebsiteAnalysis;
      suggestedDescription: string;
      normalizedUrl: string;
    }
  | {
      ok: false;
      reason:
        | "INVALID_URL"
        | "NO_WEBSITE_CONTENT"
        | "ANALYSIS_FAILED"
        | "NOT_AUTHENTICATED";
    };

/**
 * Minimum length we treat as a "real" business summary. The analyzer is
 * cheap to call but occasionally returns a near-empty stub for very thin
 * pages (single-page domains, parked domains, JS-only shells). Below this
 * threshold we surface ANALYSIS_FAILED and let the user write their own
 * description rather than auto-fill a useless draft.
 */
const MIN_SUMMARY_LENGTH = 30;

/**
 * Apply the same URL normalisation used by the form schema, so the on-blur
 * action and the on-submit action agree on what counts as the "same" URL
 * (the saveOnboardingAction compares this against the cached URL to decide
 * whether to reuse the cached analysis or re-scrape).
 *
 * Returns `null` when the input is empty, whitespace-only, or fails the
 * URL constructor after normalisation.
 */
function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const withScheme =
    lower.startsWith("http://") || lower.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;
  try {
    new URL(withScheme);
    return withScheme;
  } catch {
    return null;
  }
}

/**
 * Live website-analysis server action (Phase 1, on-blur enrichment).
 *
 * Fires from the onboarding form as soon as the user tabs out of the URL
 * input, so by the time they reach the description textarea a suggested
 * draft is already waiting (or auto-filled if the textarea is still empty).
 *
 * Why this is gated on a Better Auth session:
 *   - The scrape + Anthropic analysis costs real money per call. Requiring
 *     an authenticated session is a small but effective control against an
 *     unauthenticated actor flooding the action with arbitrary URLs.
 *   - The form is only ever rendered to a signed-in user, so the gate
 *     never blocks a legitimate caller.
 *
 * The action is intentionally non-throwing in the success path — all
 * failures are returned as a typed `{ ok: false, reason }` so the client
 * can render a calm fallback hint instead of an error boundary.
 */
export async function analyzeWebsiteAction(
  url: string
): Promise<WebsiteAnalysisResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { ok: false, reason: "NOT_AUTHENTICATED" };
  }

  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return { ok: false, reason: "INVALID_URL" };
  }

  // scrapeAndAnalyzeWebsite returns null on either scrape or analyzer
  // failure and never throws — see the service-method docblock.
  const analysis = await profileService.scrapeAndAnalyzeWebsite(normalizedUrl);
  if (!analysis) {
    return { ok: false, reason: "NO_WEBSITE_CONTENT" };
  }

  const suggestedDescription = analysis.businessSummary.trim();
  if (suggestedDescription.length < MIN_SUMMARY_LENGTH) {
    return { ok: false, reason: "ANALYSIS_FAILED" };
  }

  return {
    ok: true,
    analysis,
    suggestedDescription,
    normalizedUrl,
  };
}

/**
 * UI-layer schema. We parse against this first because:
 *   - FormData fields are snake_case (matches HTML form name attributes).
 *   - The "I don't have a website yet" checkbox is a UI concept that the
 *     service layer doesn't need to know about — it just sees `websiteUrl: null`.
 *   - Validating client-supplied data with a deliberate, locked-down schema
 *     here means the service-layer schema can stay focused on persistence.
 */
const onboardingFormSchema = z
  .object({
    business_name: z
      .string()
      .trim()
      .min(1, "Please enter your business name.")
      .max(200, "Business name is too long."),
    // Normalise the URL at the schema boundary so the rest of the action
    // sees a canonical value. The user is allowed to type "mywebsite.com"
    // (no scheme) — we prepend `https://` before the refine below validates
    // syntax. Empty / whitespace-only input collapses to `undefined` so the
    // "no website" refine can branch on it cleanly.
    website_url: z
      .string()
      .trim()
      .optional()
      .transform((v) => {
        if (!v) return undefined;
        const lower = v.toLowerCase();
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
          return v;
        }
        return `https://${v}`;
      }),
    has_no_website: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true" || v === "1"),
    business_type: z.enum(BUSINESS_TYPES, {
      message: "Please choose a business type.",
    }),
    business_description: z
      .string()
      .trim()
      .min(1, "Tell us a little about your business.")
      .max(2000, "Description is too long — keep it under 2000 characters."),
    tone_preference: z.enum(["casual", "professional", "mix"], {
      message: "Pick a voice.",
    }),
    platforms: z
      .array(z.enum(["facebook", "instagram", "linkedin"]))
      .min(1, "Choose at least one platform."),
  })
  .refine(
    (data) => data.has_no_website || (data.website_url && data.website_url.length > 0),
    {
      message: "Add your website URL, or check \"I don't have a website yet\".",
      path: ["website_url"],
    }
  )
  .refine(
    (data) => {
      // Only require URL syntax when the user said they have a website.
      if (data.has_no_website || !data.website_url) return true;
      try {
        // The URL constructor validates absolute URLs; relative paths throw.
        new URL(data.website_url);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "That doesn't look like a valid URL.",
      path: ["website_url"],
    }
  );

/**
 * Convert a Zod issue list into a flat `{ fieldName: message }` map keyed by
 * the FormData field name. Only the first issue per field is reported — the
 * form UI only renders one error string per field, and surfacing the
 * remaining issues would be noise.
 */
function flattenFieldErrors(
  issues: z.ZodIssue[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path[0];
    if (typeof path === "string" && !(path in out)) {
      out[path] = issue.message;
    }
  }
  return out;
}

export async function saveOnboardingAction(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { ok: false, error: "You need to be signed in to continue." };
  }

  // Step 1: parse + validate the form payload.
  const raw = {
    business_name: formData.get("business_name")?.toString() ?? "",
    website_url: formData.get("website_url")?.toString() ?? "",
    has_no_website: formData.get("has_no_website")?.toString() ?? "",
    business_type: formData.get("business_type")?.toString() ?? "",
    business_description:
      formData.get("business_description")?.toString() ?? "",
    tone_preference: formData.get("tone_preference")?.toString() ?? "",
    platforms: formData.getAll("platforms").map((v) => v.toString()),
  };

  const parsed = onboardingFormSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please review the highlighted fields.",
      fieldErrors: flattenFieldErrors(parsed.error.issues),
    };
  }

  const form = parsed.data;
  const websiteUrl = form.has_no_website ? null : form.website_url ?? null;

  // Step 2: content policy. Sync, no I/O — cheap to run before the scrape.
  const policy = checkContentPolicy({
    businessType: form.business_type,
    businessDescription: form.business_description,
  });
  if (policy.blocked) {
    return { ok: false, error: policy.reason };
  }

  // Step 3: opportunistic website enrichment. The service method never
  // throws — it returns `null` on scrape or analyzer failure — so this
  // step is safe to inline. We accept the latency (~5-10s) as the cost
  // of personalising the first week of posts; the UI surfaces a
  // "Reading your website…" loading state while we wait.
  //
  // Cache reuse: the client may have already run `analyzeWebsiteAction`
  // on blur of the URL input, in which case it forwards the resulting
  // analysis JSON via two hidden form fields. If those are present, the
  // cache URL matches the current normalised URL, and the cache parses
  // as a valid `WebsiteAnalysis`, we skip the second scrape. Anything
  // suspicious about the cache (URL drift, malformed JSON, missing
  // fields) falls through to a live scrape — safer to spend a couple
  // dollars on a duplicate analysis than to persist a forged blob.
  let websiteAnalysis: WebsiteAnalysis | null = null;
  if (websiteUrl) {
    const cachedAnalysisRaw = formData
      .get("website_analysis_cache")
      ?.toString();
    const cachedAnalysisUrl = formData
      .get("website_analysis_cache_url")
      ?.toString();

    if (cachedAnalysisRaw && cachedAnalysisUrl === websiteUrl) {
      try {
        const parsed = JSON.parse(cachedAnalysisRaw) as WebsiteAnalysis;
        // Light structural check — verifies all six WebsiteAnalysis fields
        // exist with the right primitive shape. A heavier Zod schema is
        // overkill here because the value is never trusted: it's only ever
        // used as the JSONB blob persisted on the profile, where the worst
        // case of a forged-but-shaped value is a slightly weird first-week
        // post.
        if (
          typeof parsed.businessSummary === "string" &&
          Array.isArray(parsed.servicesOffered) &&
          typeof parsed.targetAudience === "string" &&
          typeof parsed.brandTone === "string" &&
          Array.isArray(parsed.uniqueSellingPoints) &&
          Array.isArray(parsed.suggestedTopics)
        ) {
          websiteAnalysis = parsed;
        }
      } catch {
        // Malformed cache — fall through to a live scrape.
      }
    }

    if (!websiteAnalysis) {
      websiteAnalysis = await profileService.scrapeAndAnalyzeWebsite(
        websiteUrl
      );
    }
  }

  // Step 4: shape the payload for the service layer and upsert. The service
  // schema expects camelCase keys; this is the boundary where we translate.
  const profileInput: SaveProfileInput = {
    businessName: form.business_name,
    websiteUrl,
    businessType: form.business_type,
    businessDescription: form.business_description,
    tonePreference: form.tone_preference,
    platforms: form.platforms,
    websiteAnalysis,
  };

  try {
    await profileService.saveProfile(session.user.id, profileInput);
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_INPUT") {
      return {
        ok: false,
        error: "Some fields look invalid. Please review and try again.",
      };
    }
    // Phase 3 D6 / task-14: Starter users are capped at 2 platforms. The
    // form's client-side picker already blocks the third click, but a
    // forged submit (or a plan that flipped to Starter mid-onboarding)
    // can still slip past, so the service layer enforces the same cap
    // (Wave 2 task-04). Map the thrown code to a field-level error so the
    // platforms picker shows the inline message rather than a top-level
    // banner. Copy here intentionally differs slightly from the
    // client-side block message ("continue" vs "switch") to match the
    // submit-time context.
    if (err instanceof Error && err.message === "PLATFORMS_OVERAGE_FOR_PLAN") {
      return {
        ok: false,
        fieldErrors: {
          platforms:
            "Starter plan covers 2 platforms — uncheck one to continue.",
        },
      };
    }
    // Unexpected DB failure — log server-side and surface a generic error.
    console.error("[onboarding] saveProfile failed", err);
    return {
      ok: false,
      error: "Something went wrong saving your profile. Please try again.",
    };
  }

  // Step 5: ensure the user has a trial row. Idempotent via the unique
  // index on `subscriptions.user_id`, so safe to call even if the Better
  // Auth user-create hook already inserted one.
  try {
    await subscriptionService.startTrial(session.user.id);
  } catch (err) {
    // A missing subscription row is recoverable on the next dashboard load
    // — don't block onboarding completion for it.
    console.error("[onboarding] startTrial failed", err);
  }

  // Step 6: set the proxy's profile-gate cookie via the shared helper, which
  // is also used by the cookie-sync route handler. Centralising the cookie
  // name / options avoids drift between the two write sites.
  await setHasProfileCookie();

  return { ok: true, redirectTo: "/onboarding/done" };
}
