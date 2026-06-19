import { postService } from "@/lib/services";

/**
 * Three at-a-glance numbers on the Settings page: Posts Created lifetime,
 * Posts Scheduled (pending), Connected Accounts (0/3 platforms). Moved here
 * from the deleted `/dashboard` page during the navigation redesign — the
 * dashboard had hardcoded zeros for two of the three; the new helpers in
 * `post-service` return real values.
 *
 * Order follows the user's locked decision: Posts Created → Posts
 * Scheduled → Connected Accounts.
 *
 * Stats grid sits inside the Settings page's `max-w-2xl` column. At `sm+`
 * the three cards lay out side-by-side; below `sm` they stack.
 */
export async function ActivityStatsSection({ userId }: { userId: string }) {
  const [postsCreated, postsScheduled, connectedAccounts] = await Promise.all([
    postService.countTotalPostsCreated(userId),
    postService.countScheduledPendingForUser(userId),
    postService.countConnectedPlatformsForUser(userId),
  ]);

  return (
    <section className="space-y-4">
      <h2 className="font-fraunces text-2xl font-medium tracking-tight">
        Activity
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatBox label="Posts Created" value={postsCreated} />
        <StatBox label="Posts Scheduled" value={postsScheduled} />
        <StatBox
          label="Connected Accounts"
          value={connectedAccounts}
          max={3}
        />
      </div>
    </section>
  );
}

function StatBox({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max?: number;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6 shadow-soft text-center space-y-2">
      <p className="font-fraunces text-3xl font-medium tracking-tight tabular-nums">
        {value}
        {max != null ? (
          <span className="text-muted-foreground text-xl">/{max}</span>
        ) : null}
      </p>
      <p className="text-xs font-medium tracking-wider uppercase text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
