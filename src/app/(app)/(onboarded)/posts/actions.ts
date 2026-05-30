"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { SelectionPlatform } from "@/lib/schema";
import { postService } from "@/lib/services";

/**
 * Server actions backing `/posts` interactions (Phase 2 task-08). Each
 * action is a thin wrapper that:
 *   1. Re-resolves the session — the (onboarded) layout guarantees one,
 *      but actions can be hit from stale clients, so we re-check.
 *   2. Forwards to the matching postService method, passing the trusted
 *      `session.user.id` (never a client-supplied userId).
 *
 * Ownership / batch-status guards live inside postService — these wrappers
 * don't duplicate the logic; they just give client components a stable
 * server-action import surface.
 */

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}

// Used by <WizardStep /> (task-09).
export async function selectForNetworkAction(
  postId: string,
  platform: SelectionPlatform
) {
  const session = await requireSession();
  return await postService.selectForNetwork(postId, session.user.id, platform);
}

export async function deselectForNetworkAction(
  postId: string,
  platform: SelectionPlatform
) {
  const session = await requireSession();
  return await postService.deselectForNetwork(
    postId,
    session.user.id,
    platform
  );
}

// Used by <EditDialog /> (task-12).
export async function updatePostAction(
  postId: string,
  updates: { postText?: string; hashtags?: string[] }
) {
  const session = await requireSession();
  return await postService.update(postId, session.user.id, updates);
}

// Used by <RegenerateDialog /> (task-12).
export async function regeneratePostAction(postId: string, feedback: string) {
  const session = await requireSession();
  return await postService.regenerate(postId, session.user.id, feedback);
}

// Used by <WizardSummary /> (task-10).
export async function scheduleMyPickAction(batchId: string) {
  const session = await requireSession();
  return await postService.scheduleMyPick(batchId, session.user.id);
}

// Used by <WizardSummary /> when rendered in `mode="cancelled"`. Same
// shape as scheduleMyPickAction but calls the cancelled→scheduling
// transition. See `postService.reschedule` for the loop semantics.
export async function rescheduleAction(batchId: string) {
  const session = await requireSession();
  return await postService.reschedule(batchId, session.user.id);
}

// Used by <LockedSummary /> (task-11).
export async function stopBatchAction(batchId: string) {
  const session = await requireSession();
  return await postService.stopBatch(batchId, session.user.id);
}
