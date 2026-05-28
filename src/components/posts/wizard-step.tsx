"use client";

import type { BatchForReview } from "@/lib/services/post-service";
import type { SelectionPlatform } from "@/lib/schema";

/**
 * Per-network step in the {@link NetworkWizard}. Renders the 7 posts in
 * that network's preview format with checkbox + Edit/Regenerate actions.
 *
 * **Wave 5 stub.** This file currently renders a placeholder card list so
 * task-08's skeleton compiles. Task-09 replaces the body with the real
 * card grid (checkbox, network preview, Edit dialog, Regenerate dialog,
 * stale-variation inline note).
 */
export function WizardStep({
  platform,
  posts,
}: {
  platform: SelectionPlatform;
  posts: BatchForReview["posts"];
  batchTheme: string;
}) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
          Review for {networkLabel(platform)}
        </h2>
        <p className="text-sm text-muted-foreground">
          Wave 5 will replace this view with the real {posts.length}-card
          grid. For now this is a placeholder so the wizard skeleton
          compiles.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map((post) => (
          <li
            key={post.id}
            className="bg-card rounded-2xl border border-border p-6 shadow-soft"
          >
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              Post {post.postOrder} / 7
            </p>
            <p className="mt-2 text-sm line-clamp-4">{post.postText}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function networkLabel(platform: SelectionPlatform): string {
  switch (platform) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "linkedin":
      return "LinkedIn";
  }
}
