"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { LibraryImage, SelectionPlatform } from "@/lib/schema";
import { imageService, postService } from "@/lib/services";

/**
 * Instant per-row Schedule from the `/schedule-posts` tabs view. Wraps
 * `postService.scheduleForNetwork` — inserts the `post_selections` row
 * for `(postId, platform)` and auto-flips the parent batch from
 * `'reviewing'` to `'scheduling'` if needed, so the row immediately
 * surfaces on `/posting-soon`.
 */
export async function scheduleSinglePostAction(
  postId: string,
  platform: SelectionPlatform,
): Promise<
  | { ok: true }
  | { ok: false; error: "not_found" | "not_owned" | "failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await postService.scheduleForNetwork(
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

  revalidatePath("/schedule-posts");
  revalidatePath("/posting-soon");
  return { ok: true };
}

/**
 * Bulk "Schedule all for {Network}" from the `/schedule-posts` tabs
 * view. Inserts `post_selections` rows for every (post, platform) combo
 * the user owns that isn't already selected for `platform`. Returns the
 * count of added rows so the toast can read "Scheduled N Facebook
 * posts."
 */
export async function scheduleAllForNetworkAction(
  platform: SelectionPlatform,
): Promise<
  | { ok: true; added: number }
  | { ok: false; error: "failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await postService.bulkScheduleAllUnscheduledForNetwork(
    session.user.id,
    platform,
  );
  if (!result.ok) {
    return { ok: false, error: "failed" };
  }

  revalidatePath("/schedule-posts");
  revalidatePath("/posting-soon");
  return { ok: true, added: result.added };
}

/**
 * Library-pick action backing the "From library" tab of
 * `<UploadImageDialog>`. Wraps `imageService.pickFromLibraryForPost`,
 * which references the library blob URL directly (no copy) and bumps
 * `library_images.lastUsedAt` so the monthly cleanup keeps the chosen
 * image alive.
 */
export async function pickFromLibraryAction(
  postId: string,
  libraryImageId: string,
): Promise<
  | { ok: true; imageUrl: string }
  | {
      ok: false;
      error: "not_found" | "not_owned" | "library_image_not_found" | "failed";
    }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const result = await imageService.pickFromLibraryForPost(
    session.user.id,
    postId,
    libraryImageId,
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "db_failed" ? "failed" : result.error,
    };
  }

  revalidatePath("/schedule-posts");
  revalidatePath("/posting-soon");
  revalidatePath("/library");
  return { ok: true, imageUrl: result.imageUrl };
}

/**
 * Lazy library list loader backing the "From library" tab of
 * `<UploadImageDialog>`. Fires only when the user actually switches to
 * that tab, so the dialog's initial mount stays cheap (most users will
 * upload, not pick).
 */
export async function loadLibraryForPickerAction(): Promise<LibraryImage[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return imageService.listLibrary(session.user.id);
}
