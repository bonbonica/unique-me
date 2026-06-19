# Task 04: Sidebar reorder + delete Currently Posting + dead code cleanup

## Status

pending

## Wave

1

## Description

Reshape the left sidebar into the new 6-item order with new labels and icons, retire the `/posts/currently-posting` route entirely (the concept disappears in the new IA), and clean up the dormant `currently_posting` `derivedState` code that nothing in Stage-1 actually sets. After this task, the sidebar matches the redesign exactly; the only orphan is `/cancelled-posts` showing empty sections (populated in later waves).

## Dependencies

**Depends on:** task-03 (the sidebar Cancelled Posts entry needs `/cancelled-posts` to exist as a real route)
**Blocks:** task-06 (Wave 2 expects the sidebar already updated)

**Context from dependencies:** task-03 creates `/cancelled-posts/page.tsx` with two empty sections. The route is reachable but contains no real data yet. This task's sidebar entry should link there. task-01 and task-02 each touch the sidebar to update one entry (the renamed/added one); this task absorbs those small edits into the larger reshape — do not re-do them, just confirm the final array matches the spec below.

## Files to Create

None.

## Files to Modify

- `src/components/dashboard/sidebar.tsx` — replace the items array with the new 6-entry order, labels, hrefs, and icons.
- `src/lib/services/post-service.ts` — remove the dormant `currently_posting` `derivedState` case from `BatchBoxData` (around line 245 per exploration report — verify exact location) and any helper code that only existed to compute it. Also remove `getCurrentlyPostingBatch` helper (post-service.ts:442) if it's used **only** by the deleted page. Grep for callers before deleting.

## Files to Delete

- `src/app/(app)/(onboarded)/posts/currently-posting/page.tsx`
- Any sibling files inside `posts/currently-posting/` (loading.tsx, error.tsx if present)
- The empty `src/app/(app)/(onboarded)/posts/currently-posting/` folder

## Technical Details

### Implementation Steps

1. **Verify sidebar source.** Read `src/components/dashboard/sidebar.tsx`. The items array sits around lines 47–57 per the exploration report. Confirm shape before modifying.
2. **Replace the items array** with the new structure (final, in this exact order):

   ```ts
   import {
     Sparkles,        // Create Posts
     ClipboardList,   // Schedule Posts
     Calendar,        // Posting Soon
     Image as ImageIcon, // Image Library
     Settings,        // Settings
     XCircle,         // Cancelled Posts
   } from "lucide-react";

   const items = [
     { label: "Create Posts",   href: "/create",          icon: Sparkles },
     { label: "Schedule Posts", href: "/schedule-posts",  icon: ClipboardList },
     { label: "Posting Soon",   href: "/posting-soon",    icon: Calendar },
     { label: "Image Library",  href: "/library",         icon: ImageIcon },
     { label: "Settings",       href: "/settings",        icon: Settings },
     { label: "Cancelled Posts",href: "/cancelled-posts", icon: XCircle },
   ];
   ```

   Use the project's existing item type/interface — don't invent a new shape. Match the icon size convention (default `size-5`) and stroke width (1.5 per `DESIGN.md` § 10) already used by other items.
3. **Remove the Currently Posting entry** from the items array. (It was: `{ label: "Currently Posting", href: "/posts/currently-posting", icon: Send }`.)
4. **Delete the Currently Posting route files.** Delete:
   - `src/app/(app)/(onboarded)/posts/currently-posting/page.tsx`
   - Any sibling files inside `posts/currently-posting/`
   - The empty folder itself
5. **Remove dead `currently_posting` derivedState code.**
   - Grep for `currently_posting` across `src/`. Expect hits in:
     - `src/lib/services/post-service.ts` — `BatchBoxData.derivedState` union and any branch that sets/checks it (around line 245 per exploration report; verify).
     - Possibly `src/lib/services/posting-service.ts` or related types.
   - Remove the union member, any switch/branch that handles it, and any helper that exists only to produce it.
   - **Be careful with `getCurrentlyPostingBatch`** at post-service.ts:442 (per exploration). Grep for callers. If the **only** caller was the deleted `posts/currently-posting/page.tsx`, delete the helper. If there are other callers (e.g. dashboard or a CTA component), leave the helper but note it as dead-on-arrival to be cleaned up in Wave 3 task-08 (which deletes the dashboard).
6. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`. Expect zero errors. If typecheck complains about an unused import or a stale type member, clean it up.
7. Dev-server check: load the app, confirm the sidebar shows the 6 new items in order with correct labels/icons, no broken links. Confirm `/posts/currently-posting` returns 404.

### Code Snippets

The dormant derivedState union is something like:

```ts
type BatchBoxData = {
  // ...
  derivedState: "upcoming" | "currently_posting" | "completed" | ...;
};
```

After this task:

```ts
type BatchBoxData = {
  // ...
  derivedState: "upcoming" | "completed" | ...;  // currently_posting removed
};
```

### Notes on what NOT to change

- Do not add a redirect for `/posts/currently-posting` here — task-05 owns redirects. (For Currently Posting specifically, a redirect isn't strictly needed because nothing in production points there externally, but task-05 may still add a 404-safety redirect to `/posting-soon`.)
- Do not change the sidebar component's structure (visuals, the wrapper `<nav>`, accessibility attributes). Items array only.
- Do not touch any code in the `/posting-soon` or `/schedule-posts` page files — tasks 01 and 02 own those.

## Acceptance Criteria

- [ ] Sidebar items array contains exactly the 6 entries listed above in the specified order with the specified labels and icons.
- [ ] No "Currently Posting" entry remains in the sidebar.
- [ ] `src/app/(app)/(onboarded)/posts/currently-posting/` directory is fully removed.
- [ ] Grep for `currently_posting` (string) and `currently-posting` (path) returns zero results in `src/`, except possibly in a future-deferred TODO comment.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
- [ ] Dev-server: all 6 sidebar items navigate to their correct destinations; `/posts/currently-posting` returns 404.

## Notes

- Icon choices above are suggestions consistent with existing usage (Sparkles for create, Calendar for scheduled-out, XCircle for cancelled). If the project already uses different icons for these concepts, prefer the established choice for consistency.
- If `getCurrentlyPostingBatch` has callers outside the deleted route, leave it for now; Wave 3 task-08 (which removes the dashboard) is the most likely place those calls disappear. Don't risk breaking the dashboard mid-wave.
