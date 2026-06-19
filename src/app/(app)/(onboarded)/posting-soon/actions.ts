"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { SelectionPlatform } from "@/lib/schema";
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
 * their selections without losing the work they already committed. Kept
 * after the `/posting-soon` tabs rebuild (no UI surface points here today)
 * so the backend `reopenForEditing` contract stays callable.
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
  revalidatePath("/schedule-posts");
  revalidatePath(`/schedule-posts/${batchId}`);
  return { ok: true };
}

/**
 * Per-network unschedule from the `/posting-soon` tabs view. Deletes the
 * `post_selections` row for (postId, platform) so the row stops appearing
 * in that network's tab. The post itself stays in the batch — other
 * networks' selections (if any) are untouched.
 */
export async function unschedulePostAction(
  postId: string,
  platform: SelectionPlatform,
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await postService.unschedulePostForNetwork(
    postId,
    platform,
    session.user.id,
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "db_failed" ? "failed" : result.error,
    };
  }

  revalidatePath("/posting-soon");
  return { ok: true };
}

/**
 * Per-post hard delete from the `/posting-soon` tabs view. Moves the
 * post's image to the user's library, then deletes the post (cascade
 * fires across scheduled_posts → post_selections → post_variations →
 * post_images). Revalidates `/library` so the freshly-retained image
 * appears immediately.
 */
export async function deletePostAction(
  postId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await postService.deletePost(postId, session.user.id);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "db_failed" ? "failed" : result.error,
    };
  }

  revalidatePath("/posting-soon");
  revalidatePath("/library");
  return { ok: true };
}
