import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Champagne CTA shown on `/create` gated screens when the user has an
 * `in_progress` batch they should be steered back to. Per DESIGN.md §9
 * the primary CTA on a focal surface uses `rounded-full` + `glow-champagne`;
 * per D-S2-17 the label reads `See the batch currently posting →`.
 *
 * Shared by `<QuotaGatedScreen />`'s `quota` and `monthly_quota` variants
 * (the two non-trial gated surfaces a user lands on while their batch is
 * mid-posting) so the copy and styling are single-sourced.
 *
 * The trailing arrow is a literal `→` character to keep the component a
 * single text node — matches the pre-Stage-2 inline link form, swapping
 * only the words before the arrow.
 */
export function CurrentlyPostingCta() {
  return (
    <Button asChild size="lg" className="rounded-full glow-champagne">
      <Link href="/posts">See the batch currently posting →</Link>
    </Button>
  );
}
