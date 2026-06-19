"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

/**
 * Cancel a `scheduling` batch from the Scheduled page. Thin wrapper around
 * `postService.stopBatch` that:
 *   1. Re-resolves the session (trusts only `session.user.id`).
 *   2. Maps the result-object contract to a UI-friendly shape.
 *   3. Revalidates both `/posting-soon` (box disappears) and `/create` (the
 *      newly-cancelled batch reappears there as a re-schedulable card —
 *      D-S6 in the redesign spec).
 *
 * `stopBatch` returns `{ ok: false, error }` instead of throwing; the dialog
 * surfaces the `already_cancelled` case explicitly and treats every other
 * failure as a generic error toast.
 */
export async function cancelBatchAction(
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: "already_cancelled" | "failed" }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await postService.stopBatch(batchId, session.user.id);

  if (!result.ok) {
    if (result.error === "not_scheduling") {
      return { ok: false, error: "already_cancelled" };
    }
    return { ok: false, error: "failed" };
  }

  revalidatePath("/posting-soon");
  revalidatePath("/create");
  return { ok: true };
}

/**
 * Reopen a `scheduling` batch back to `reviewing` so the user can edit
 * their selections without losing the work they already committed. Backs
 * the "Edit selections" affordance on `/posting-soon/[batchId]` — see
 * `postService.reopenForEditing` for the underlying transition contract.
 *
 * Returns the same `{ ok }` shape `cancelBatchAction` uses so the client
 * trigger can render a single toast on failure. On success the client
 * routes to `/schedule-posts/[batchId]` where the wizard takes over.
 */
export async function reopenBatchAction(
  batchId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: "not_scheduling" | "failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await postService.reopenForEditing(batchId, session.user.id);

  if (!result.ok) {
    if (result.error === "not_scheduling") {
      return { ok: false, error: "not_scheduling" };
    }
    return { ok: false, error: "failed" };
  }

  revalidatePath("/posting-soon");
  revalidatePath(`/posting-soon/${batchId}`);
  revalidatePath("/schedule-posts");
  revalidatePath(`/schedule-posts/${batchId}`);
  return { ok: true };
}
