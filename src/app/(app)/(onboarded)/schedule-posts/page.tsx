import { headers } from "next/headers";
import Link from "next/link";
import type { DeleteWarning } from "@/components/create/delete-batch-forever-dialog";
import { UnscheduledBatchCard } from "@/components/create/unscheduled-batch-card";
import { auth } from "@/lib/auth";
import {
  postService,
  subscriptionService,
} from "@/lib/services";
import type { SubscriptionStateSnapshot } from "@/lib/services/subscription-service";

/**
 * `/schedule-posts` — Wave 1 list view of in-flight batches that need
 * review / edit / scheduling. Adopts the cards that used to live on
 * `/create` so the Create Posts hub can become a single-job page
 * (rebuilt in Wave 3 task-09).
 *
 * Wave 1 still surfaces cancelled batches here too — Wave 2 task-07
 * filters them out once `/cancelled-posts` (task-06) takes ownership of
 * cancelled-batch surfacing. Until then, cancelled cards in this list
 * preserve the existing cancelled-recoverable flow.
 *
 * Cards route into `/schedule-posts/[batchId]` via the `linkBuilder`
 * override on {@link UnscheduledBatchCard}; the default builder still
 * points at `/posts?batchId=` so `/create` (during Waves 1-2) keeps its
 * current behavior unchanged.
 */
export default async function SchedulePostsListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const [cards, subscription] = await Promise.all([
    postService.getUnscheduledBatchesForUser(session.user.id),
    subscriptionService.checkSubscription(session.user.id),
  ]);
  const warning = deriveDeleteWarning(subscription);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Schedule Posts
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Review, edit, and schedule the posts you've drafted.
        </p>
      </header>

      {cards.length === 0 ? (
        <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-3 text-center">
          <p className="text-base text-muted-foreground">
            No posts in review.
          </p>
          <p className="text-sm">
            <Link href="/create" className="text-primary hover:underline">
              Create a new set from Create Posts →
            </Link>
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <UnscheduledBatchCard
              key={card.id}
              data={card}
              warning={warning}
              linkBuilder={(id) => `/schedule-posts/${id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Same tier-aware delete-warning derivation used by `/create/page.tsx`. Kept
// duplicated for Wave 1 to avoid moving a `/create`-private helper into a
// shared module mid-redesign; Wave 3's rebuild of `/create` (task-09) will
// re-evaluate where this belongs.
function deriveDeleteWarning(
  snapshot: SubscriptionStateSnapshot,
): DeleteWarning {
  if (snapshot.status === "trial") {
    return { tier: "trial" };
  }

  if (snapshot.plan === "pro" && snapshot.proQuota) {
    if (snapshot.proQuota.used >= snapshot.proQuota.max) {
      return {
        tier: "pro_at_cap",
        nextAvailable: snapshot.proQuota.periodEndsAt,
      };
    }
    return {
      tier: "pro_under_cap",
      remaining: snapshot.proQuota.max - snapshot.proQuota.used,
    };
  }

  if (snapshot.plan === "starter" && snapshot.status === "active") {
    return { tier: "starter", nextAvailable: snapshot.nextResetAt };
  }

  return { tier: "starter", nextAvailable: snapshot.nextResetAt };
}
