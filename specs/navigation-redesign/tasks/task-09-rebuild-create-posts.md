# Task 09: Rebuild /create as Create Posts (welcome + button + 3 stats + click-time trial Dialog)

## Status

pending

## Wave

3

## Description

Rebuild `/create` as the single-job Create Posts page. The page contents become: small welcome greeting (new-vs-returning logic preserved) + primary "Create new posts" button + 3 stat boxes (Posts Scheduled · Posts Created · Connected Accounts), visible to ALL users always. The current full-page `TrialGatedScreen` is removed; trial-used users see the same Create Posts page as everyone else. The upgrade modal fires ONLY when the user clicks "Create new posts" — a blocking Dialog with an Upgrade CTA.

Wires the two currently-hardcoded stats ("Posts Scheduled" and "Connected accounts") to real values. "Posts Scheduled" = total `scheduled_posts` rows with `status = 'pending'` across all batches for the user. "Connected accounts" = number of distinct connected social platforms (0–3) via the project's existing connected-accounts service.

## Dependencies

**Depends on:** task-06, task-07 (so /create is clean and cancelled batches have their new home), task-08 (so `WelcomeGreeting` helper exists and dashboard deletion is done)
**Blocks:** task-10, task-11 (Wave 4 builds on Wave 3 baseline)

**Context from dependencies:** task-08 created `src/components/welcome-greeting.tsx` with `WelcomeGreeting({ firstName, isReturning })` and exposed a server helper for deriving `isReturning`. task-07 stripped cancelled batches from `/create`. After this task, `/create` is the full new Create Posts surface — no leftover form chrome or unscheduled-cards JSX.

## Files to Create

- `src/app/(app)/(onboarded)/create/_components/create-stats-strip.tsx` — server component, renders the 3 stat boxes.
- `src/app/(app)/(onboarded)/create/_components/create-button.tsx` — client component; renders the "Create new posts" primary button + holds the trial-upgrade Dialog state.
- `src/app/(app)/(onboarded)/create/_components/trial-upgrade-dialog.tsx` — client component for the modal Dialog (shadcn `Dialog` primitive).

## Files to Modify

- `src/app/(app)/(onboarded)/create/page.tsx` — rebuild to the new layout. Strip out the "Start new batch" form, the trial gate `<TrialGatedScreen>`, the quota gate `<QuotaGatedScreen>` (the click-time Dialog absorbs the trial case; Pro quota gate still applies — see Notes), and anything else not in the new spec. Compose the new layout from the components above + the `<WelcomeGreeting>` from task-08.
- `src/lib/services/post-service.ts` — add `countScheduledPendingForUser(userId)` helper (or similar) returning `SELECT COUNT(*) FROM scheduled_posts sp JOIN posts p ON p.id = sp.post_id JOIN weekly_batches wb ON wb.id = p.batch_id WHERE wb.user_id = ? AND sp.status = 'pending'`.
- `src/lib/services/connected-accounts-service.ts` (or wherever this lives — search) — confirm a helper exists like `countConnectedPlatformsForUser(userId)` returning 0–3 (FB/IG/LI). If not, add one.
- `src/app/(app)/(onboarded)/create/actions.ts` — `generateWeeklyAction` may need a small change: the action should be safely callable from a client (the button) and return any necessary state (post-generation redirect already happens server-side per task-02; no change there). Confirm.

## Files to Delete

- `src/components/dashboard/trial-gated-screen.tsx` (or wherever `<TrialGatedScreen>` lives) — only if it has no other callers. Grep first.
- Any legacy CreateHub form components no longer used (e.g. `create-hub-form-slot.tsx`, `generate-form.tsx`, `unscheduled-batch-list.tsx` if it's now fully orphaned). Grep each before deleting.

## Technical Details

### Implementation Steps

1. **Read current `/create/page.tsx` state.** After Waves 1–2, the page still has the "Start new batch" form. This task is the rebuild, so most of the existing layout JSX gets discarded.
2. **Build the page layout.** Editorial-content pattern from `DESIGN.md` § 8 Pattern B:

   ```tsx
   // src/app/(app)/(onboarded)/create/page.tsx
   import { auth } from "@/lib/auth"; // or project equivalent
   import { WelcomeGreeting } from "@/components/welcome-greeting";
   import { getIsReturningUser } from "@/lib/services/user-service"; // or task-08's exported helper
   import { CreateStatsStrip } from "./_components/create-stats-strip";
   import { CreateButton } from "./_components/create-button";
   import { subscriptionService } from "@/lib/services/subscription-service";

   export default async function CreatePostsPage() {
     const session = await auth();
     if (!session?.user?.id) redirect("/login");

     const [firstName, isReturning, canGenerate] = await Promise.all([
       getUserFirstName(session.user.id),
       getIsReturningUser(session.user.id),
       subscriptionService.canGenerate(session.user.id),
     ]);

     // Determine trial-gated state for the click-time dialog.
     const isTrialUsedUp =
       !canGenerate.allowed && canGenerate.reason === "trial_batch_exists";

     // Pro quota gate is still a hard block — only fire dialog if quota_active, not silent.
     const proQuotaGateReason =
       !canGenerate.allowed && canGenerate.reason === "monthly_cap_active"
         ? canGenerate
         : null;

     return (
       <div className="container mx-auto px-5 sm:px-8 lg:px-12">
         <div className="max-w-3xl mx-auto py-12 sm:py-16 space-y-12">
           <header className="space-y-2">
             <WelcomeGreeting firstName={firstName} isReturning={isReturning} />
             <h1 className="text-4xl font-medium tracking-tight font-fraunces">Create Posts</h1>
           </header>

           <CreateButton
             isTrialUsedUp={isTrialUsedUp}
             proQuotaGateReason={proQuotaGateReason}
           />

           <CreateStatsStrip userId={session.user.id} />
         </div>
       </div>
     );
   }
   ```

3. **Build the button + dialog.**

   ```tsx
   // src/app/(app)/(onboarded)/create/_components/create-button.tsx
   "use client";
   import { Button } from "@/components/ui/button";
   import { TrialUpgradeDialog } from "./trial-upgrade-dialog";
   import { useState, useTransition } from "react";
   import { useRouter } from "next/navigation";
   import { generateWeeklyAction } from "../actions";

   export function CreateButton({
     isTrialUsedUp,
     proQuotaGateReason,
   }: {
     isTrialUsedUp: boolean;
     proQuotaGateReason: { nextResetAt?: Date; batchesUsed?: number } | null;
   }) {
     const [trialOpen, setTrialOpen] = useState(false);
     const [isPending, startTransition] = useTransition();
     const router = useRouter();

     function onClick() {
       if (isTrialUsedUp) {
         setTrialOpen(true);
         return;
       }
       if (proQuotaGateReason) {
         // Re-use existing Pro quota dialog/copy. If a component already exists, mount it
         // here behind a state flag (mirror the trial dialog pattern).
         // For Wave 3 minimal scope: simply alert/toast and let user see top-bar status.
         // BETTER: build a sibling <QuotaCapDialog/> component if not already present.
         return;
       }
       startTransition(async () => {
         await generateWeeklyAction(); // existing server action; redirects on success
       });
     }

     return (
       <div className="flex justify-center">
         <Button
           size="lg"
           onClick={onClick}
           disabled={isPending}
           className="glow-champagne"
         >
           {isPending ? "Drafting this week's posts…" : "Create new posts"}
         </Button>
         <TrialUpgradeDialog open={trialOpen} onOpenChange={setTrialOpen} />
       </div>
     );
   }
   ```

4. **Trial upgrade dialog.** Use shadcn `<Dialog>` per `DESIGN.md` § 9 (Dialog spec). Content card uses `bg-card rounded-2xl border border-border shadow-float p-8`. Copy:

   - Title (Fraunces, `text-xl`): "Trial includes one set of posts"
   - Body (`text-base text-muted-foreground leading-7`): "Upgrade to keep creating posts every week."
   - Primary CTA: "Upgrade" — links to the existing pricing/upgrade route (search for it — likely `/settings` plan section or `/pricing`).
   - Secondary: "Close" (ghost variant). No exclamation points, no hyperbole.

5. **Build the stats strip.** Server component:

   ```tsx
   // src/app/(app)/(onboarded)/create/_components/create-stats-strip.tsx
   import { postService } from "@/lib/services/post-service";
   import { connectedAccountsService } from "@/lib/services/connected-accounts-service";

   export async function CreateStatsStrip({ userId }: { userId: string }) {
     const [scheduled, created, connected] = await Promise.all([
       postService.countScheduledPendingForUser(userId),
       postService.countTotalPostsCreated(userId),
       connectedAccountsService.countConnectedPlatformsForUser(userId),
     ]);

     return (
       <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
         <StatBox label="Posts Scheduled" value={scheduled} />
         <StatBox label="Posts Created"   value={created} />
         <StatBox label="Connected Accounts" value={connected} max={3} />
       </div>
     );
   }

   function StatBox({ label, value, max }: { label: string; value: number; max?: number }) {
     return (
       <div className="bg-card rounded-2xl border border-border shadow-soft p-8 text-center">
         <div className="text-4xl font-medium tracking-tight font-fraunces">
           {value}{max != null ? <span className="text-muted-foreground text-2xl">/{max}</span> : null}
         </div>
         <div className="mt-2 text-sm text-muted-foreground uppercase tracking-wide">{label}</div>
       </div>
     );
   }
   ```

6. **Add the data helpers.**
   - `postService.countScheduledPendingForUser(userId)` in `src/lib/services/post-service.ts` — `SELECT COUNT(*)` joining scheduled_posts → posts → weekly_batches filtered by user + `sp.status = 'pending'`.
   - `connectedAccountsService.countConnectedPlatformsForUser(userId)` — return number of distinct connected platforms. If the existing service exposes a "list connected accounts" function, count the result.
7. **Delete the legacy components.** Grep callers for each before deleting:
   - `TrialGatedScreen` — if only callers were `/create/page.tsx` (now rebuilt), delete the file.
   - `QuotaGatedScreen` — if no callers remain, delete. If you preferred not to build a custom Pro-quota dialog and the page still relies on `<QuotaGatedScreen>` as a full-page state for Pro users, keep it for now (acceptable — Pro quota behavior is a separate user concern).
   - `create-hub-form-slot.tsx`, `generate-form.tsx`, `unscheduled-batch-list.tsx` — confirm orphaned, delete.
   - `next-batch-banner.tsx` already deleted in task-08.
8. **Pro quota state.** The user's redesign spec explicitly addresses the TRIAL case (click-time dialog) but does not redesign the Pro quota gate. Two acceptable approaches:
   - **A (recommended for Wave 3 scope):** Leave Pro quota as a click-time dialog too — mirror the trial dialog pattern with quota copy ("X/4 sets used this period. Next reset on {date}.").
   - **B:** Keep the existing `<QuotaGatedScreen>` as a full-page block specifically for Pro users who've hit the cap, since their state is qualitatively different (paid users, expecting clarity).
   - Implement A unless the user specifies otherwise.
9. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
10. Dev-server smoke test:
    - As a fresh trial user: `/create` shows greeting + button + stats (all zeros for Posts Scheduled). Click button → generates.
    - As a trial-used user: same page; click button → Dialog opens with Upgrade CTA.
    - As a Pro user with quota remaining: page; click button → generates.
    - As a Pro user at quota cap: page; click button → quota dialog (or quota gate per chosen approach).
    - Stats reflect real numbers, not zeros.

### Notes on what NOT to change

- Do not modify the generation logic in `postService.generateWeekly`.
- Do not modify the top-bar trial pill — it's separate from this page's dialog and stays.
- Do not add a navigation surface (back/forward, breadcrumbs) — keep the page calm and focused.
- Do not delete `WelcomeGreeting` — task-08 created it; this task uses it.

## Acceptance Criteria

- [ ] `/create` renders: WelcomeGreeting (small, above page title) + "Create Posts" page title (Fraunces) + primary "Create new posts" button + 3 stat boxes (Posts Scheduled, Posts Created, Connected Accounts).
- [ ] 3 stat boxes are visible to ALL users always (including trial-used, Pro at cap, and Pro under cap).
- [ ] Stats show real values, not hardcoded zeros.
- [ ] For trial-used users: clicking the button opens the Dialog with Upgrade CTA; does NOT trigger generation.
- [ ] For users who can generate: clicking the button starts generation; on success the user lands at `/schedule-posts/[new-batch-id]` (handled by task-02's existing redirect in the server action).
- [ ] Connected Accounts displays as `0/3`, `1/3`, etc.
- [ ] Welcome greeting honors new-vs-returning logic (commit `7511329` behavior preserved via the `WelcomeGreeting` helper from task-08).
- [ ] No legacy form chrome remains on `/create` (no Start new batch form, no UnscheduledBatchList, no TrialGatedScreen full-page render, no NextBatchBanner).
- [ ] Brand voice: no exclamation points anywhere on the page or in the dialog.
- [ ] Primary CTA gets `glow-champagne` per `DESIGN.md` (focal-card / focal-CTA rule).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- The trial-Dialog's Upgrade CTA should link to the existing upgrade destination (find by grepping the current `TrialGatedScreen` for its Upgrade link — match it).
- The stats grid is `grid-cols-1 sm:grid-cols-3` per `DESIGN.md` § 8 Pattern C (card grid). Generous `gap-6`.
- If `countTotalPostsCreated` and the existing connected-accounts helper are already used by the soon-to-be-deleted dashboard page, this task's job is to keep them alive and re-use, not duplicate.
- **Pro quota dialog** (approach A from step 8): if implementing, follow the same Dialog pattern as the trial one. Copy: title "Cap reached for this period", body "You've used X of Y posts sets. Next reset on {date}.", CTA "Got it" (ghost). Save the building of a richer Pro upgrade dialog for a future spec — Wave 3's scope is the trial behavior.
