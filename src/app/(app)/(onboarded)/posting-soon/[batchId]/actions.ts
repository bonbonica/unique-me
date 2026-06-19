"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { postService } from "@/lib/services";

/**
 * Per-post Cancel and Restore server actions for `/posting-soon/[batchId]`.
 *
 * Thin wrappers around `postService.cancelPost` / `postService.restorePost`
 * (Stage-2 D-S2-6, D-S2-7, D-S2-21 — non-destructive status flips on
 * `scheduled_posts`). They:
 *   1. Re-resolve the session (trust only `session.user.id`).
 *   2. Pass the whole-post scope — Stage-2 UI never sends a per-network
 *      `platform` (see §6.9 / D-S2-6 — per-network cancel is service-layer
 *      only).
 *   3. Map the result-object contract to the UI's narrowed error union.
 *   4. Revalidate `/posting-soon/[batchId]` (this page) and `/posting-soon`
 *      (the box's per-network counts and `{N} posts` totals exclude
 *      `'cancelled'` rows per D-S2-21 readers).
 *
 * **No `revalidatePath('/library')`** in `cancelPostAction` — cancel is
 * non-destructive per the Cancel-vs-Delete contract (§0, D-S2-6): the post
 * family is preserved and the image stays attached. The image is NOT moved to
 * the Library. The future per-post `deletePost` surface (D-S2-22) is the path
 * that will reinstate the `/library` revalidation when it ships.
 */

export async function cancelPostAction(
  postId: string,
  batchId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "not_found" | "not_owned" | "already_posted" | "db_failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  // Whole-post scope — no `platform` argument. Per-network cancel UI is
  // reserved for a later spec (D-S2-6 §0).
  const result = await postService.cancelPost(session.user.id, postId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/posting-soon/${batchId}`);
  revalidatePath("/posting-soon");
  // NOTE: No revalidatePath('/library') — cancel is non-destructive per §0
  // (D-S2-6). The image stays attached to the still-existing post and is
  // NOT moved to the Library. The future `deletePost` surface (D-S2-22) is
  // the per-post path that will reinstate the `/library` revalidation; it
  // is not built in Stage-2.
  return { ok: true };
}

export async function restorePostAction(
  postId: string,
  batchId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "not_found" | "not_owned" | "not_restorable" | "db_failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  // Whole-post scope — mirrors cancel; per-network restore UI is reserved.
  const result = await postService.restorePost(session.user.id, postId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/posting-soon/${batchId}`);
  revalidatePath("/posting-soon");
  return { ok: true };
}
