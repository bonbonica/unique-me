import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService, subscriptionService } from "@/lib/services";
import { GenerateForm } from "@/components/create/generate-form";
import { TrialGatedScreen } from "@/components/create/trial-gated-screen";
import { TrialNote } from "@/components/create/trial-note";

/**
 * `/create` page (Phase 2 task-07). Two render paths driven by subscription
 * status + existing-batch state:
 *
 *  1. **Gated** — trial user who already has any batch (D20). Renders the
 *     `<TrialGatedScreen />`, hides the form. Cancelling a trial batch
 *     doesn't reset the cap, so a user with one cancelled batch still
 *     lands here.
 *  2. **Form** — everyone else (trial users with no batch, non-trial
 *     users). Renders the explainer + optional trial note + 2-field
 *     generate form.
 *
 * The (onboarded) layout already guarantees authentication + a complete
 * profile, so we only re-verify the session defensively. Subscription
 * fetch is one extra DB query on top of the layout's existing one — Next
 * caches at the request scope, so this is effectively free.
 */
export default async function CreatePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  const subscription = await subscriptionService.checkSubscription(
    session.user.id
  );

  // Gate (D20): trial + any batch (incl. cancelled) → upgrade screen.
  if (subscription.status === "trial") {
    const hasBatch = await postService.hasAnyBatch(session.user.id);
    if (hasBatch) {
      // For the "Review the batch you made" link, we look up the user's
      // most-recent in-flight batch. If the only batch is cancelled the
      // lookup returns null and the link silently drops — `getCurrentBatch`
      // intentionally doesn't surface cancelled batches.
      const currentBatch = await postService.getCurrentBatch(session.user.id);
      return (
        <TrialGatedScreen existingBatchId={currentBatch?.id ?? null} />
      );
    }
  }

  const daysLeft = subscription.daysLeftInTrial;
  const showTrialNote =
    subscription.status === "trial" && daysLeft !== null && daysLeft > 0;

  return (
    <div className="max-w-2xl mx-auto">
      <header className="space-y-3">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Create this week&apos;s posts
        </h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll write 7 posts for Facebook this week. Pro users also get
          matching Instagram and LinkedIn versions of each.
        </p>
        {showTrialNote ? <TrialNote daysLeft={daysLeft} /> : null}
      </header>

      <div className="mt-10">
        <GenerateForm />
      </div>
    </div>
  );
}
