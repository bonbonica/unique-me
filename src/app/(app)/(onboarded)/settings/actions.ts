"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { profileService } from "@/lib/services";

/**
 * Wave 3 task-7 (onboarding-posting-preferences spec §5).
 *
 * Writes `profiles.posting_days` from the Settings page's
 * `<PostingDaysSection />` segmented radio. Mirrors the structured-result
 * convention used by `deleteBatchForeverAction` (no redirect on
 * unauthenticated — the caller is a `useTransition` inside a long-lived
 * page; a mid-transition redirect would jank the optimistic UI).
 *
 * Error union:
 *   - `unauthenticated` — session re-resolution failed.
 *   - `invalid` — caller passed a value outside the allowed three.
 *   - `db_failed` — `profileService.updateProfile` threw (PROFILE_NOT_FOUND,
 *     INVALID_INPUT, or any other persistence failure). Collapsed to a
 *     single bucket because the Settings UI only needs a generic retry toast.
 *
 * On success we `revalidatePath("/settings")` so the server-rendered
 * `initial` prop re-reads on next navigation; the local state in
 * `<PostingDaysSection />` already reflects the user's choice for the
 * current render via optimistic update.
 */
export async function updatePostingDaysAction(
  value: "every_day" | "working_days_only" | "weekends_only",
): Promise<
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "invalid" | "db_failed" }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  // Defensive narrowing — TypeScript only checks at compile time, but this
  // action sits at a trust boundary (client RPC), so we re-validate the
  // string against the allowed union before handing it to the service.
  if (
    value !== "every_day" &&
    value !== "working_days_only" &&
    value !== "weekends_only"
  ) {
    return { ok: false, error: "invalid" };
  }

  try {
    await profileService.updateProfile(session.user.id, {
      postingDays: value,
    });
  } catch {
    // `profileService.updateProfile` throws on INVALID_INPUT and
    // PROFILE_NOT_FOUND; either way the user surface is the same generic
    // retry toast, so we collapse them here.
    return { ok: false, error: "db_failed" };
  }

  revalidatePath("/settings");
  return { ok: true };
}
