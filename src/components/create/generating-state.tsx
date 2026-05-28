"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Loading surface shown in place of {@link GenerateForm} while the
 * `generateWeeklyAction` server action is in flight (Phase 2 task — UX
 * polish, post-Wave-4).
 *
 * What it solves:
 *   A real Anthropic call for a Pro batch takes ~60-120 seconds. With no
 *   visible progress, users have signed out / reloaded / closed the tab
 *   thinking the app died. This component sells the wait: a focal
 *   champagne spinner, rotating reassurance copy, and a determinate-
 *   looking progress bar that fills based on elapsed time.
 *
 * Important design notes:
 *   - The progress bar is **cosmetic**. We can't get real progress from
 *     Anthropic's tool-use API (it returns nothing until the entire
 *     response is ready). The bar caps at 95% so it never appears "done"
 *     before the redirect actually lands.
 *   - The rotating headline is **also cosmetic** — none of the messages
 *     map to a real backend stage. They exist to make the wait feel like
 *     four short steps instead of one long block (a measured UX trick;
 *     not deceptive because the user can't act on the messages anyway).
 *   - On `prefers-reduced-motion`, the spinner still spins (Tailwind's
 *     animate-spin honours the media query implicitly via the browser),
 *     the headline fade is unaffected, and the progress bar still
 *     updates — but smoothly. We don't add explicit overrides because
 *     the motion footprint is already minimal.
 *
 * Recovery model: if the user navigates away mid-flight, the server
 * action keeps running (in dev mode for sure; on Vercel, see Phase 4
 * background-job notes), the batch lands in the DB, and the user can
 * return to `/posts` to see it via `postService.getCurrentBatch`. This
 * component doesn't need to know about that — it just stays mounted
 * while pending and unmounts on success-redirect or error-state-flip.
 */

const HEADLINES = [
  "Reading your brand profile…",
  "Drafting this week's posts…",
  "Adapting each post for every network…",
  "Polishing the hashtags…",
  "Almost there…",
] as const;

const HEADLINE_INTERVAL_SECONDS = 15;
const EXPECTED_DURATION_SECONDS = 90;
const PROGRESS_CAP_PERCENT = 95;

export function GeneratingState() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Headline cycles every 15s, sticks on the last entry after the final swap.
  const headlineIndex = Math.min(
    Math.floor(elapsedSeconds / HEADLINE_INTERVAL_SECONDS),
    HEADLINES.length - 1
  );
  const headline = HEADLINES[headlineIndex]!;

  // Linear fill to the cap. The cap prevents the bar from looking "done"
  // before the actual redirect — if the call takes longer than expected,
  // the bar holds steady rather than reaching 100% and feeling stuck.
  const progressPercent = Math.min(
    PROGRESS_CAP_PERCENT,
    (elapsedSeconds / EXPECTED_DURATION_SECONDS) * 100
  );

  return (
    <div className="max-w-md mx-auto text-center mt-12 sm:mt-16 space-y-8">
      {/* Champagne focal spinner. The bordered ring + glow gives it the
          DESIGN.md focal-task weight; without the wrapping circle the bare
          Loader2 looked too small for a 90-second wait. */}
      <div className="flex justify-center">
        <div className="size-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center glow-champagne">
          <Loader2
            className="animate-spin size-10 text-primary"
            aria-hidden
          />
        </div>
      </div>

      {/* Rotating headline. `key` forces React to unmount/remount on every
          swap so the `animate-fade-in` utility (defined in globals.css)
          retriggers cleanly — otherwise the text would swap without
          animation. */}
      <h2
        key={headlineIndex}
        className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium animate-fade-in"
        aria-live="polite"
      >
        {headline}
      </h2>

      {/* Determinate-looking cosmetic progress bar. The 500ms transition on
          width keeps each one-second tick from looking jittery — the bar
          smooths between integer-second updates. */}
      <div
        className="h-1.5 w-full bg-muted rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(progressPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Generation progress"
      >
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <p className="text-sm text-muted-foreground leading-7">
        This usually takes 60–120 seconds. Stay on this page — we&apos;ll
        take you to the posts as soon as they&apos;re ready.
      </p>
    </div>
  );
}
