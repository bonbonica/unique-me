"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react";
import {
  analyzeWebsiteAction,
  saveOnboardingAction,
  type OnboardingState,
} from "@/app/(app)/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_TYPES } from "@/lib/profile/constants";
import { type WebsiteAnalysis } from "@/lib/schema";

/**
 * Onboarding form client component (Phase 1, spec § 1.4).
 *
 * Uses React 19's `useActionState` so the form posts directly to the
 * `saveOnboardingAction` server action and the returned `state` drives the
 * UI's error / success rendering. Every visible input is controlled by a
 * single `values` object so React 19's default behaviour of resetting
 * uncontrolled inputs after an action runs does NOT wipe the user's typed
 * content on a validation failure — only the field's red-flag indicator
 * changes; the value stays.
 *
 * Live website analysis (added Phase 1.5):
 *   When the user tabs out of the Website URL input, we fire
 *   `analyzeWebsiteAction` in a transition. By the time the user reaches
 *   the description textarea further down the form, either:
 *     - the textarea is auto-filled with a suggested draft (if empty), or
 *     - a "Use this draft" affordance appears above the textarea (if the
 *       user has already typed their own content).
 *   The resulting `WebsiteAnalysis` object is forwarded back to
 *   `saveOnboardingAction` via two hidden form inputs so submit never
 *   re-runs the scrape for a URL we've already analyzed.
 *
 * DESIGN.md compliance:
 *   - Pattern D (focal task) — single column, generous padding
 *   - § 9 input defaults — `bg-muted h-11`, `min-h-32 bg-muted` textarea
 *   - § 9 button — primary `rounded-full glow-champagne` size="lg"
 *   - § 11 motion — analysis hints use 200-300ms ease-out transitions
 *   - Brand voice — no exclamation points
 */

type ToneValue = "casual" | "professional" | "mix" | "";
type PlatformValue = "facebook" | "instagram" | "linkedin";

type FormValues = {
  businessName: string;
  websiteUrl: string;
  noWebsite: boolean;
  businessType: string;
  businessDescription: string;
  tone: ToneValue;
  platforms: ReadonlyArray<PlatformValue>;
};

/**
 * Lifecycle of the on-blur analysis request.
 *   idle    — nothing in flight, no result yet (initial + when noWebsite
 *             is toggled on, or the user clears the URL).
 *   pending — the action is in flight; the UI shows a spinner hint under
 *             the URL field and under the description label.
 *   ready   — the action returned `{ ok: true }`; `analysis` and
 *             `suggestedDescription` are populated and either the
 *             auto-fill or the "Use this draft" card is shown.
 *   error   — the action returned `{ ok: false }` for any reason. We
 *             surface a soft fallback hint under the URL field — never a
 *             top-level error banner, because the user can still fill the
 *             form manually.
 */
type AnalysisStatus = "idle" | "pending" | "ready" | "error";

const INITIAL_VALUES: FormValues = {
  businessName: "",
  websiteUrl: "",
  noWebsite: false,
  businessType: "",
  businessDescription: "",
  tone: "",
  platforms: [],
};

const INITIAL_STATE: OnboardingState = { ok: false };

const PLATFORM_OPTIONS: ReadonlyArray<{
  value: PlatformValue;
  label: string;
}> = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
];

const TONE_OPTIONS: ReadonlyArray<{
  value: Exclude<ToneValue, "">;
  label: string;
}> = [
  { value: "casual", label: "Casual" },
  { value: "professional", label: "Professional" },
  { value: "mix", label: "Mix of both" },
];

export function OnboardingForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    saveOnboardingAction,
    INITIAL_STATE
  );

  // Every visible input is controlled via a single state object. React 19's
  // `<form action>` resets *uncontrolled* inputs after the action runs;
  // controlling each value here keeps the user's typed content sticky
  // across validation re-renders so they don't have to re-type after a
  // server-returned error.
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);

  // Live-analysis state. Kept separate from `values` because nothing here
  // is submitted as a user-edited field — the analysis blob and its URL
  // are forwarded via hidden inputs at submit time.
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysis, setAnalysis] = useState<WebsiteAnalysis | null>(null);
  const [analyzedUrl, setAnalyzedUrl] = useState<string>("");
  const [suggestedDescription, setSuggestedDescription] = useState<string>("");

  // useTransition wraps the on-blur server action so the form stays
  // interactive while the scrape/analysis runs (5-10s).
  const [, startAnalysisTransition] = useTransition();

  // Generic field updater — preserves type safety per key without forcing
  // each handler to spread `prev` inline.
  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Stable ids for label/input pairing. `useId` is the canonical React 19
  // pattern — it avoids hydration mismatches when the form is rendered on
  // the server and rehydrated on the client.
  const idBusinessName = useId();
  const idWebsiteUrl = useId();
  const idHasNoWebsite = useId();
  const idBusinessType = useId();
  const idDescription = useId();
  const idTone = useId();

  /**
   * Reset everything analysis-related. Called when the user toggles
   * "I don't have a website yet" ON, so a stale draft from a previous URL
   * doesn't survive into a profile that has no website at all.
   */
  function resetAnalysis() {
    setAnalysisStatus("idle");
    setAnalysis(null);
    setAnalyzedUrl("");
    setSuggestedDescription("");
  }

  // Toggling "I don't have a website yet" clears the URL value AND disables
  // the input. Clearing matters because if the user typed something invalid
  // first, leaving the value behind would survive the toggle and trip the
  // server-side URL validation on submit.
  function handleNoWebsiteChange(checked: boolean) {
    setValues((prev) => ({
      ...prev,
      noWebsite: checked,
      websiteUrl: checked ? "" : prev.websiteUrl,
    }));
    if (checked) {
      resetAnalysis();
    }
  }

  /**
   * Fire the on-blur analysis. Bails on noop cases (empty URL, noWebsite
   * checked, same URL as the last successful analysis) so the user can
   * tab through the field without triggering duplicate work.
   *
   * On success we populate the cache (so submit can skip the scrape) and
   * surface the "Use this draft" affordance above the description
   * textarea. We do NOT silently auto-fill the textarea — every field
   * action stays explicit, so the user always knows what's about to land
   * in their profile.
   *
   * On failure we set status to "error" — the status line below the URL
   * input renders an actionable destructive-colour message ("Couldn't
   * read that website — check the URL and try again") instead of a
   * silent no-op, which was the bug pre-polish.
   */
  function analyzeUrl(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!trimmed || values.noWebsite) {
      return;
    }
    // Skip the work when the input on blur matches the URL we already
    // analyzed — covers the common "user tabs back through the field
    // without editing it" pattern.
    if (trimmed === analyzedUrl) {
      return;
    }

    setAnalysisStatus("pending");
    startAnalysisTransition(async () => {
      const result = await analyzeWebsiteAction(trimmed);
      if (result.ok) {
        setAnalysis(result.analysis);
        setSuggestedDescription(result.suggestedDescription);
        setAnalyzedUrl(result.normalizedUrl);
        setAnalysisStatus("ready");
      } else {
        // The status line under the URL input renders the destructive
        // error variant. We don't try to distinguish reasons in the copy
        // — all four reduce to the same user action ("check the URL").
        setSuggestedDescription("");
        setAnalysis(null);
        setAnalysisStatus("error");
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[onboarding] analyzeWebsiteAction failed:",
            result.reason
          );
        }
      }
    });
  }

  function togglePlatform(value: PlatformValue, checked: boolean) {
    setValues((prev) => {
      const next = checked
        ? Array.from(new Set([...prev.platforms, value]))
        : prev.platforms.filter((p) => p !== value);
      return { ...prev, platforms: next };
    });
  }

  // The submit button stays disabled until every required field has a
  // valid-shape value. The server schema enforces these too; duplicating
  // them here is a UX affordance so the user can see at a glance whether
  // they're done. We deliberately do NOT disable submit while an analysis
  // is in flight — the server falls back to a live scrape in that case,
  // matching the pre-feature behaviour.
  const hasWebsiteAnswer =
    values.noWebsite || values.websiteUrl.trim().length > 0;
  const canSubmit =
    values.businessName.trim().length > 0 &&
    hasWebsiteAnswer &&
    values.businessType.length > 0 &&
    values.businessDescription.trim().length > 0 &&
    values.tone !== "" &&
    values.platforms.length > 0 &&
    !pending;

  // On successful submit the action returns a redirect target. `replace`
  // (not `push`) so the back button doesn't return to the now-stale form.
  useEffect(() => {
    if (state.ok) {
      router.replace(state.redirectTo);
    }
  }, [state, router]);

  const fieldErrors = state.ok ? undefined : state.fieldErrors;
  const topLevelError = state.ok ? null : state.error;

  // The submit-button label changes while pending to communicate which
  // slow step is running. Scrape + analyze can take 5-10s when the cache
  // is empty, so we differentiate.
  const submitLabel = useMemo(() => {
    if (!pending) return "Finish onboarding";
    // If we already have a cached analysis for the current URL, the
    // server will skip the scrape and the submit is fast.
    const willScrapeOnSubmit =
      values.websiteUrl.trim().length > 0 &&
      !values.noWebsite &&
      values.websiteUrl.trim() !== analyzedUrl;
    if (willScrapeOnSubmit) {
      return "Reading your website…";
    }
    return "Saving…";
  }, [pending, values.websiteUrl, values.noWebsite, analyzedUrl]);

  // Derived UI flags for the description field. Kept inline at the call
  // site below would clutter the JSX; pulling them up here keeps the
  // render readable.
  // The "Use this draft" affordance always shows when a fresh suggestion
  // is ready AND the textarea content doesn't already match it. We never
  // auto-fill silently — the user has to click the affordance to apply.
  // Once they click, the trim-comparison hides the card; if they edit
  // away from the suggestion, the card re-appears.
  const showDraftCard =
    analysisStatus === "ready" &&
    suggestedDescription.length > 0 &&
    values.businessDescription.trim() !== suggestedDescription.trim();
  const showDraftingHint = analysisStatus === "pending";

  return (
    <form action={formAction} className="space-y-8 mt-12" noValidate>
      {topLevelError ? (
        <div
          role="alert"
          className="p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm"
        >
          {topLevelError}
        </div>
      ) : null}

      {/* Hidden analysis cache. Forwarded to saveOnboardingAction so it can
          skip re-scraping when the URL hasn't changed since the on-blur
          analysis. Both fields are only rendered when we actually have a
          cached result for the current URL — otherwise the action falls
          through to a live scrape, matching the pre-feature behaviour. */}
      {analysis && analyzedUrl ? (
        <>
          <input
            type="hidden"
            name="website_analysis_cache"
            value={JSON.stringify(analysis)}
          />
          <input
            type="hidden"
            name="website_analysis_cache_url"
            value={analyzedUrl}
          />
        </>
      ) : null}

      {/* 1. Business name --------------------------------------------------- */}
      <div>
        <Label htmlFor={idBusinessName} className="mb-2">
          Business name
        </Label>
        <Input
          id={idBusinessName}
          name="business_name"
          type="text"
          autoComplete="organization"
          placeholder="The Velvet Pour"
          required
          value={values.businessName}
          onChange={(e) => update("businessName", e.target.value)}
          className="h-11 bg-muted"
          aria-invalid={Boolean(fieldErrors?.business_name) || undefined}
          aria-describedby={
            fieldErrors?.business_name
              ? `${idBusinessName}-error`
              : undefined
          }
        />
        {fieldErrors?.business_name ? (
          <p
            id={`${idBusinessName}-error`}
            className="mt-1.5 text-xs text-destructive"
          >
            {fieldErrors.business_name}
          </p>
        ) : null}
      </div>

      {/* 2. Website URL + "no website" toggle ------------------------------ */}
      <div>
        <Label htmlFor={idWebsiteUrl} className="mb-2">
          Website URL
        </Label>
        <Input
          id={idWebsiteUrl}
          name="website_url"
          // Intentionally `type="text"` (not `"url"`) so the browser doesn't
          // pre-reject values without a scheme — the server-side schema
          // normalises "mywebsite.com" → "https://mywebsite.com" before
          // validating. `inputMode="url"` keeps the mobile URL keyboard.
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="yourbusiness.com"
          value={values.websiteUrl}
          onChange={(e) => update("websiteUrl", e.target.value)}
          onBlur={(e) => analyzeUrl(e.target.value)}
          disabled={values.noWebsite}
          className="h-11 bg-muted"
          aria-invalid={Boolean(fieldErrors?.website_url) || undefined}
          aria-describedby={
            fieldErrors?.website_url
              ? `${idWebsiteUrl}-error`
              : `${idWebsiteUrl}-status`
          }
        />
        {fieldErrors?.website_url ? (
          <p
            id={`${idWebsiteUrl}-error`}
            className="mt-1.5 text-xs text-destructive"
          >
            {fieldErrors.website_url}
          </p>
        ) : (
          // Single status line below the input. The content swaps based on
          // the analysis lifecycle, but the line itself is always present
          // so the URL field's height doesn't shift between states.
          <p
            id={`${idWebsiteUrl}-status`}
            className="mt-1.5 text-xs text-muted-foreground flex items-center gap-2"
            aria-live="polite"
          >
            {analysisStatus === "pending" ? (
              <>
                <Loader2
                  className="animate-spin size-3.5"
                  aria-hidden="true"
                />
                <span>Reading your website… this takes a few seconds.</span>
              </>
            ) : analysisStatus === "ready" ? (
              <>
                <Check className="size-3.5 text-primary" aria-hidden="true" />
                <span>
                  Got it. We&apos;ve drafted a starter description below.
                </span>
              </>
            ) : analysisStatus === "error" ? (
              <>
                <AlertCircle
                  className="size-3.5 text-destructive shrink-0"
                  aria-hidden="true"
                />
                <span className="text-destructive">
                  Couldn&apos;t read that website — check the URL and try
                  again.
                </span>
              </>
            ) : (
              <span>
                We&apos;ll read your site to learn your voice and offerings.
              </span>
            )}
          </p>
        )}

        <label
          htmlFor={idHasNoWebsite}
          className="mt-3 inline-flex items-center gap-2.5 text-sm text-muted-foreground cursor-pointer"
        >
          <Checkbox
            id={idHasNoWebsite}
            name="has_no_website"
            checked={values.noWebsite}
            onCheckedChange={(checked) =>
              handleNoWebsiteChange(checked === true)
            }
          />
          <span>I don&apos;t have a website yet</span>
        </label>
      </div>

      {/* 3. Business type -------------------------------------------------- */}
      <div>
        <Label htmlFor={idBusinessType} className="mb-2">
          Business type
        </Label>
        <Select
          name="business_type"
          value={values.businessType}
          onValueChange={(v) => update("businessType", v)}
        >
          <SelectTrigger
            id={idBusinessType}
            className="h-11 w-full bg-muted"
            aria-invalid={Boolean(fieldErrors?.business_type) || undefined}
            aria-describedby={
              fieldErrors?.business_type
                ? `${idBusinessType}-error`
                : undefined
            }
          >
            <SelectValue placeholder="Select your business type" />
          </SelectTrigger>
          <SelectContent>
            {BUSINESS_TYPES.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors?.business_type ? (
          <p
            id={`${idBusinessType}-error`}
            className="mt-1.5 text-xs text-destructive"
          >
            {fieldErrors.business_type}
          </p>
        ) : null}
      </div>

      {/* 4. Tone ----------------------------------------------------------- */}
      <div>
        <Label htmlFor={idTone} className="mb-2">
          Casual or professional?
        </Label>
        <Select
          name="tone_preference"
          value={values.tone}
          onValueChange={(v) => update("tone", v as ToneValue)}
        >
          <SelectTrigger
            id={idTone}
            className="h-11 w-full bg-muted"
            aria-invalid={Boolean(fieldErrors?.tone_preference) || undefined}
            aria-describedby={
              fieldErrors?.tone_preference ? `${idTone}-error` : undefined
            }
          >
            <SelectValue placeholder="Pick a voice" />
          </SelectTrigger>
          <SelectContent>
            {TONE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors?.tone_preference ? (
          <p id={`${idTone}-error`} className="mt-1.5 text-xs text-destructive">
            {fieldErrors.tone_preference}
          </p>
        ) : null}
      </div>

      {/* 5. Platforms ------------------------------------------------------ */}
      <div>
        <span className="block text-sm font-medium mb-2">
          Which platforms?
        </span>
        <div className="space-y-2">
          {PLATFORM_OPTIONS.map((opt) => {
            const checked = values.platforms.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/40 hover:bg-muted cursor-pointer transition-colors"
              >
                <Checkbox
                  name="platforms"
                  value={opt.value}
                  checked={checked}
                  onCheckedChange={(c) => togglePlatform(opt.value, c === true)}
                />
                <span className="text-sm font-medium">{opt.label}</span>
              </label>
            );
          })}
        </div>
        {fieldErrors?.platforms ? (
          <p className="mt-1.5 text-xs text-destructive">
            {fieldErrors.platforms}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Pick at least one. You can add more later in Settings.
          </p>
        )}
      </div>

      {/* 6. Business description ------------------------------------------ */}
      <div>
        {/* Draft-suggestion card — shown only when the analysis came back
            with a draft AND the user has typed their own content (so we
            won't overwrite it). Clicking "Use this draft" replaces the
            textarea content and marks it as auto-filled, which causes the
            card to disappear and the small under-textarea hint to appear
            instead. */}
        {showDraftCard ? (
          <div className="mb-3 rounded-lg border border-primary/30 bg-primary/10 p-3 flex items-start gap-3">
            <Sparkles
              className="size-4 text-primary shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex-1 text-sm">
              <p className="font-medium">
                We drafted a description from your website.
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                {suggestedDescription}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => update("businessDescription", suggestedDescription)}
              className="rounded-full shrink-0"
            >
              Use this draft
            </Button>
          </div>
        ) : null}

        <Label htmlFor={idDescription} className="mb-2">
          Tell us about your business
        </Label>

        {/* Mid-analysis hint shown between the label and the textarea so
            the user knows a suggestion is coming. */}
        {showDraftingHint ? (
          <p
            className="mb-2 text-xs text-muted-foreground flex items-center gap-1.5"
            aria-live="polite"
          >
            <Loader2 className="animate-spin size-3.5" aria-hidden="true" />
            <span>Drafting a suggestion from your website…</span>
          </p>
        ) : null}

        <Textarea
          id={idDescription}
          name="business_description"
          required
          value={values.businessDescription}
          onChange={(e) => update("businessDescription", e.target.value)}
          className="min-h-32 bg-muted"
          placeholder="A neighbourhood wine and small-plates bar in Brooklyn, focused on natural wines and seasonal sharing menus."
          aria-invalid={
            Boolean(fieldErrors?.business_description) || undefined
          }
          aria-describedby={
            fieldErrors?.business_description
              ? `${idDescription}-error`
              : `${idDescription}-hint`
          }
        />
        {fieldErrors?.business_description ? (
          <p
            id={`${idDescription}-error`}
            className="mt-1.5 text-xs text-destructive"
          >
            {fieldErrors.business_description}
          </p>
        ) : (
          <p
            id={`${idDescription}-hint`}
            className="mt-1.5 text-xs text-muted-foreground"
          >
            What do you do, who do you serve, what makes you different?
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={!canSubmit}
        className="w-full rounded-full glow-champagne"
      >
        {pending ? (
          <Loader2 className="animate-spin size-4 mr-2" aria-hidden="true" />
        ) : null}
        {submitLabel}
      </Button>
    </form>
  );
}
