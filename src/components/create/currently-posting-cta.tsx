import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Champagne CTA shown on `/create` gated screens when the user has a
 * scheduling batch they should be steered back to. Per DESIGN.md §9 the
 * primary CTA on a focal surface uses `rounded-full` + `glow-champagne`.
 *
 * Shared by `<QuotaGatedScreen />`'s `quota` and `monthly_quota` variants.
 *
 * Wave 1 of the navigation redesign retired the dedicated
 * `/posts/currently-posting` route — this CTA now points directly at
 * `/posting-soon`, where the user can see every batch waiting to publish.
 * The component itself becomes redundant once Wave 3 (task-09) rebuilds
 * `/create` and removes `<QuotaGatedScreen />`; until then it stays so
 * the existing gated screens keep working.
 */
export function CurrentlyPostingCta() {
  return (
    <Button asChild size="lg" className="rounded-full glow-champagne">
      <Link href="/posting-soon">
        See posts scheduled to publish →
      </Link>
    </Button>
  );
}
