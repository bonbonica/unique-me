import { headers } from "next/headers";
import { SchedulePostsTabs } from "@/components/schedule-posts/schedule-posts-tabs";
import { auth } from "@/lib/auth";
import type { SelectionPlatform } from "@/lib/schema";
import {
  postService,
  profileService,
  subscriptionService,
} from "@/lib/services";

/**
 * `/schedule-posts` — network-tabs view of every unscheduled
 * `(post, platform)` combo across reviewing AND scheduling batches.
 * Posts are grouped by batch under a theme/important-thing header.
 *
 * Per-row Schedule button instantly inserts a `post_selections` row and
 * the row jumps to `/posting-soon`. A per-tab "Schedule all for
 * {Network}" button does the same in bulk.
 *
 * `isPro` is threaded down so the per-row image renderer
 * (`<PostTileImage>`) shows the Pro corner regenerate icon for Pro
 * users only.
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content): `max-w-3xl`,
 * generous `space-y-8`.
 */
export default async function SchedulePostsListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const [profile, subscription] = await Promise.all([
    profileService.getProfile(session.user.id),
    subscriptionService.checkSubscription(session.user.id),
  ]);
  // Cast: `profile.platforms` is `string[]` per Drizzle's inferred type
  // because the column is `text[]`. The onboarding form's Zod schema
  // constrains the values to the SelectionPlatform union.
  const platforms = (profile?.platforms ?? []) as SelectionPlatform[];
  const isPro = subscriptionService.hasProFeatures(subscription);

  const postsByPlatform = await postService.getAllUnscheduledPostsForUser(
    session.user.id,
    platforms,
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Schedule Posts
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Review, edit, and schedule the posts you&apos;ve drafted.
        </p>
      </header>

      <SchedulePostsTabs
        platforms={platforms}
        postsByPlatform={postsByPlatform}
        isPro={isPro}
      />
    </div>
  );
}
