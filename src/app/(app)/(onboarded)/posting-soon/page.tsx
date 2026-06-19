import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PostingSoonTabs } from "@/components/posting-soon/posting-soon-tabs";
import { auth } from "@/lib/auth";
import type { SelectionPlatform } from "@/lib/schema";
import { postService, profileService } from "@/lib/services";

/**
 * `/posting-soon` — network-tabs rebuild. Replaces the previous rolling-4
 * batch-grid view with a per-platform list of every scheduled post for
 * the user, ordered by scheduled date ascending.
 *
 * Tabs are driven by `profile.platforms` (the user's onboarding
 * selection). A platform shows up here even when it has zero scheduled
 * posts — the empty-state copy lives inside the tab panel rather than
 * suppressing the tab.
 *
 * Reader source — PRESENT-DAY (mirrors `<BatchDetailView />`'s choice):
 * reads `post_selections` rather than `scheduled_posts` because no writer
 * populates the latter today. See
 * {@link postService.getAllScheduledPostsForUser} for the swap-back
 * criteria.
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content): `max-w-3xl`,
 * generous `space-y-8`.
 */
export default async function PostingSoonPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [profile, postsByPlatform] = await Promise.all([
    profileService.getProfile(session.user.id),
    postService.getAllScheduledPostsForUser(session.user.id),
  ]);

  // Cast: `profile.platforms` is `string[]` per Drizzle's inferred type
  // because the column is `text[]`. The onboarding form's Zod schema
  // constrains the values to the SelectionPlatform union, so the cast is
  // safe under normal operation. Mirrors the same cast in
  // `getBatchForReview`.
  const platforms = (profile?.platforms ?? []) as SelectionPlatform[];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header>
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Posting Soon
        </h1>
      </header>

      <PostingSoonTabs
        platforms={platforms}
        postsByPlatform={postsByPlatform}
      />
    </div>
  );
}
