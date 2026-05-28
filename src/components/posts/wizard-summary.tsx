"use client";

import type { BatchForReview } from "@/lib/services/post-service";
import { Button } from "@/components/ui/button";

/**
 * Final wizard step (Phase 2 task-10). Lists every selected (post, network)
 * combination, lets the user remove individual items, and exposes the
 * single "Schedule my pick" commit action.
 *
 * **Wave 5 stub.** Renders a minimal listing so the skeleton compiles;
 * task-10 replaces this with the real interactive summary (X-to-remove,
 * empty state, server-action wiring).
 */
export function WizardSummary({
  batch,
  posts,
  platforms,
}: {
  batch: BatchForReview["batch"];
  posts: BatchForReview["posts"];
  platforms: BatchForReview["platforms"];
}) {
  const items: Array<{
    postId: string;
    postOrder: number;
    postText: string;
    platform: string;
  }> = [];
  for (const post of posts) {
    for (const platform of post.selections) {
      if (platforms.includes(platform)) {
        items.push({
          postId: post.id,
          postOrder: post.postOrder,
          postText: post.postText,
          platform,
        });
      }
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="font-fraunces text-2xl sm:text-3xl tracking-tight font-medium">
          Review your week
        </h2>
        <p className="text-sm text-muted-foreground">
          Wave 5 will replace this with the real summary (remove buttons,
          empty state, commit action). Showing the current selections for
          batch <code className="text-xs">{batch.id.slice(0, 8)}</code> only.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No posts selected. Go back to any network step to pick some.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={`${item.postId}:${item.platform}`}
              className="bg-card border border-border rounded-lg px-4 py-3"
            >
              <p className="text-sm font-medium">
                Post {item.postOrder} to {item.platform}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {item.postText}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border pt-6 flex justify-end">
        <Button
          disabled
          size="lg"
          className="rounded-full glow-champagne"
          title="Wave 5 wires this up"
        >
          Schedule my pick
        </Button>
      </div>
    </section>
  );
}
