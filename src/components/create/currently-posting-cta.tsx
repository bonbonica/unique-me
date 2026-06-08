import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Champagne CTA shown on `/create` gated screens when the user has a
 * scheduling batch they should be steered back to. Per DESIGN.md §9 the
 * primary CTA on a focal surface uses `rounded-full` + `glow-champagne`;
 * label reads `Currently Posting on Social Media →` (was
 * `See the batch currently posting →` per D-S2-17 — relabeled to surface
 * the live-on-social-media meaning directly rather than the generic
 * "current batch" framing).
 *
 * Shared by `<QuotaGatedScreen />`'s `quota` and `monthly_quota` variants
 * (the two non-trial gated surfaces a user lands on while their batch is
 * mid-posting) so the copy and styling are single-sourced.
 *
 * **Href** points to `/posts/currently-posting` — a thin server route that
 * resolves the batch via `postService.getCurrentlyPostingBatch` (Pro:
 * batch where ordinal matches the current period week; Starter / Trial:
 * oldest scheduling/completed) and renders `<LockedSummary />` inline at
 * that URL. Same destination the sidebar's "Currently Posting" nav item
 * uses, so both entry paths produce the SAME end URL — and the sidebar
 * item highlights identically whether the user arrived from this CTA or
 * clicked the nav directly. No batchId is constructed here; the
 * destination route owns the resolution.
 *
 * The trailing arrow is a literal `→` character to keep the component a
 * single text node — matches the pre-Stage-2 inline link form, swapping
 * only the words before the arrow.
 */
export function CurrentlyPostingCta() {
  return (
    <Button asChild size="lg" className="rounded-full glow-champagne">
      <Link href="/posts/currently-posting">
        Currently Posting on Social Media →
      </Link>
    </Button>
  );
}
