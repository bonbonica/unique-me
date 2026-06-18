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

// ============================================================================
// Image library Wave 3 — monthly cleanup, lock toggle, bulk delete, download.
// All thin wrappers around imageService; ownership and tier guards live in
// the service so these stay focused on session + revalidation.
// ============================================================================

/**
 * Pure inspection — the onboarded layout calls this on every session to
 * decide whether to mount the cleanup-reminder dialog. Does NOT mutate
 * `lastCleanupCheckMonth`; that's `runMonthlyCleanupAction`'s job.
 * The client passes `currentMonthYyyyMm` resolved from the browser TZ.
 */
export async function checkMonthlyCleanupAction(
  currentMonthYyyyMm: string,
): Promise<
  | { ok: true; cleanupNeeded: boolean; shouldShowReminder: boolean; count: number; over: number }
  | { ok: false; error: "unauthenticated" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const state = await imageService.inspectMonthlyCleanupState(
    session.user.id,
    currentMonthYyyyMm,
  );
  return { ok: true, ...state };
}

/**
 * Run the cleanup for real. Fired by the Proceed button on the modal OR
 * directly by the onboarded layout when `shouldShowReminder=false` and
 * `cleanupNeeded=true` (silent path). Revalidates `/library` so the page
 * reflects the new row set on next visit.
 */
export async function runMonthlyCleanupAction(
  currentMonthYyyyMm: string,
): Promise<imageService.CleanupResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await imageService.runMonthlyCleanup(
    session.user.id,
    currentMonthYyyyMm,
  );
  revalidatePath("/library");
  return result;
}

/**
 * Set `monthlyCleanupReminderDismissed = true`. One-way in Wave 3 — no
 * Settings toggle to re-enable.
 */
export async function dismissCleanupReminderAction(): Promise<
  { ok: true } | { ok: false; error: "unauthenticated" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  await imageService.markCleanupReminderDismissed(session.user.id);
  return { ok: true };
}

/**
 * Toggle the padlock on a single library tile. Optimistic UI happens
 * client-side; this just persists the state.
 */
export async function toggleLibraryImageLockAction(
  libraryImageId: string,
  lock: boolean,
): Promise<
  { ok: true } | { ok: false; error: "not_found" | "not_owned" | "unauthenticated" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await imageService.toggleLibraryImageLock(
    session.user.id,
    libraryImageId,
    lock,
  );
  if (!result.ok) return result;

  revalidatePath("/library");
  return { ok: true };
}

/**
 * Bulk delete. The "Delete all" button on the library header uses
 * `"unlocked-only"`. The post-download popup offers both modes — `"all"`
 * is the destructive option that ignores locks.
 */
export async function deleteAllLibraryImagesAction(
  mode: "unlocked-only" | "all",
): Promise<
  { ok: true; deleted: number } | { ok: false; error: "unauthenticated" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await imageService.deleteAllLibraryImages(
    session.user.id,
    mode,
  );
  revalidatePath("/library");
  return result;
}

/**
 * Resolve the URL the browser will GET to download the ZIP. The action
 * exists so the click flows through the standard server-action import
 * surface even though the actual download is a plain GET. Session check
 * here is defense-in-depth; the route handler also re-checks.
 */
export async function getLibraryDownloadUrlAction(): Promise<
  { ok: true; url: string } | { ok: false; error: "unauthenticated" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  return { ok: true, url: "/api/library/download" };
}
