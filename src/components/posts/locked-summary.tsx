"use client";

import Link from "next/link";
import type { BatchForReview } from "@/lib/services/post-service";
import { Button } from "@/components/ui/button";

/**
 * Read-only view rendered when the batch is in `"scheduling"` or
 * `"cancelled"` status (Phase 2 task-11). Same shape as
 * {@link WizardSummary} but with no controls.
 *
 *  - `scheduling` → shows the locked listing + "Stop entire batch" button
 *    (placeholder in Wave 4, fully wired in Wave 5).
 *  - `cancelled` → shows a cancelled banner + "Start a new batch" link.
 *
 * **Wave 5 stub.** Real interactions (confirmation Dialog + stopBatch
 * action wiring) land in task-11.
 */
export function LockedSummary({ data }: { data: BatchForReview }) {
  const isCancelled = data.batch.status === "cancelled";
  const isScheduling = data.batch.status === "scheduling";

  const items: Array<{
    postId: string;
    postOrder: number;
    postText: string;
    platform: string;
  }> = [];
  for (const post of data.posts) {
    for (const platform of post.selections) {
      items.push({
        postId: post.id,
        postOrder: post.postOrder,
        postText: post.postText,
        platform,
      });
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          {isCancelled ? "Batch cancelled" : "Your selections are locked"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isCancelled
            ? "This batch was cancelled. Nothing was posted."
            : "Your selections are locked. Stopping will cancel the batch."}
        </p>
      </header>

      {isCancelled ? (
        <div className="rounded-2xl border border-border bg-muted px-6 py-4 text-sm">
          <Link href="/create" className="underline">
            Start a new batch →
          </Link>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No posts were selected.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={`${item.postId}:${item.platform}`}
              className="bg-card border border-border rounded-lg px-4 py-3 opacity-90"
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

      {isScheduling ? (
        <div className="border-t border-border pt-6">
          {/* Wave 5 (task-11) replaces this with a Dialog-confirmed stop
              flow wired to stopBatchAction. */}
          <Button
            variant="destructive"
            className="rounded-lg"
            disabled
            title="Wave 5 wires this up"
          >
            Stop entire batch
          </Button>
        </div>
      ) : null}
    </div>
  );
}
