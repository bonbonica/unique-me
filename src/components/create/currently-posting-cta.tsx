import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Champagne CTA shown on `/create` gated screens when the user has an
 * `in_progress` batch they should be steered back to. Per DESIGN.md §9
 * the primary CTA on a focal surface uses `rounded-full` + `glow-champagne`;
 * label reads `Currently Posting on Social Media →` (was
 * `See the batch currently posting →` per D-S2-17 — relabeled to surface
 * the live-on-social-media meaning directly rather than the generic
 * "current batch" framing).
 *
 * Shared by `<QuotaGatedScreen />`'s `quota` and `monthly_quota` variants
 * (the two non-trial gated surfaces a user lands on while their batch is
 * mid-posting) so the copy and styling are single-sourced.
 *
 * The trailing arrow is a literal `→` character to keep the component a
 * single text node — matches the pre-Stage-2 inline link form, swapping
 * only the words before the arrow.
 *
 * `batchId` prop is the server-resolved target from
 * `postService.getCurrentlyPostingBatch` — the OLDEST `scheduling |
 * completed` batch, i.e. the one whose posting window fires first. When
 * supplied the CTA opens `/posts?batchId={id}` so `<LockedSummary />` and
 * its heading land on the correct ordinal (`Batch 1/4` for a Pro user's
 * first batch, etc.). When omitted (no `scheduling | completed` batch
 * exists yet — e.g. all batches still in `reviewing`), the CTA opens
 * bare `/posts` and falls through to `getResumableBatch` (newest in any
 * resumable status) as a defensive last resort.
 */
export function CurrentlyPostingCta({
  batchId,
}: {
  batchId?: string | null;
} = {}) {
  const href = batchId ? `/posts?batchId=${batchId}` : "/posts";
  return (
    <Button asChild size="lg" className="rounded-full glow-champagne">
      <Link href={href}>Currently Posting on Social Media →</Link>
    </Button>
  );
}
