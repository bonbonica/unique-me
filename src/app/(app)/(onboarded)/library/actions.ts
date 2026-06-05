"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";

/**
 * Delete a single library image (D-S2-18). Thin wrapper around
 * `imageService.deleteLibraryImage` that:
 *   1. Re-resolves the session (trusts only `session.user.id`).
 *   2. Forwards the service's structured `{ ok, error }` result verbatim — the
 *      dialog surfaces the `not_found` case explicitly and treats every other
 *      failure as a generic error toast.
 *   3. Revalidates `/library` so the just-deleted tile disappears on the next
 *      paint (the page is server-rendered).
 *
 * Mirrors the shape of `cancelBatchAction` in `schedule/actions.ts`. Unlike
 * batch cancel, this IS truly destructive: the underlying blob is `del()`-ed
 * by the service before the row is removed.
 */
export async function deleteLibraryImageAction(
  libraryImageId: string,
): Promise<
  { ok: true } | { ok: false; error: "not_found" | "not_owned" | "unauthenticated" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await imageService.deleteLibraryImage(
    session.user.id,
    libraryImageId,
  );

  if (!result.ok) return result;

  revalidatePath("/library");
  return { ok: true };
}
