# Requirements: Navigation Redesign

## Summary

UniqueMe's left sidebar and page set have grown alongside the product and now show their seams: the user has a dashboard, a Create hub, a Review/Schedule page, a Currently Posting page, and a Scheduled grid — five surfaces that overlap in purpose and confuse the natural left-to-right flow of "create → review → schedule → publish". This redesign reshapes the navigation into a single linear story: **Create Posts → Schedule Posts → Posting Soon → (Image Library / Settings) → Cancelled Posts**, deletes the dashboard, retires the dormant Currently Posting page, and introduces a proper Cancelled Posts page with both whole-batch and per-post recovery.

The redesign **does not change any underlying logic** for generation, review, editing, regeneration, or scheduling. It reorganizes and renames pages, moves the dashboard's stat boxes to Create Posts (always visible to everyone), converts the trial gate from a full-page block into a click-time modal, adds per-post and bulk cancel to the scheduled view, and relabels "batch" → "week" in friendly UI copy (quota copy stays in batches because the quota model itself is a separate future project).

The expected outcome: a calmer, more obvious app that surfaces fewer screens, ships per-post cancel control that has been backend-ready since Stage-2, and lets trial users see the real product on day one without a wall in the way.

## Goals

- Reshape the sidebar into the new 6-item order: Create Posts, Schedule Posts, Posting Soon, Image Library, Settings, Cancelled Posts.
- Delete `/dashboard` entirely; root (`/`) lands on Create Posts.
- Reduce Create Posts to a single primary CTA ("Create new posts") plus three always-visible stat boxes (Posts Scheduled · Posts Created · Connected Accounts).
- Convert the trial-used gate from a full-page `TrialGatedScreen` into a click-time blocking Dialog modal — trial-used users see the normal page until they tap the button.
- After generation finishes, auto-route the user directly into the per-batch review view for the new batch (today's behavior, just on the new URL).
- Add per-post cancel and bulk cancel ("Select" mode) on Posting Soon.
- Build the Cancelled Posts page with two sections: cancelled whole batches up top, cancelled single posts below.
- Add a single-post restore path: restores to original time if still future; otherwise opens a time-picker.
- Retire the `/posts/currently-posting` route and the dormant `currently_posting` derivedState code.
- Relabel "batch" → "week" in friendly UI copy across the app; **leave quota copy in batches**.
- Reduce inline explanatory text on the touched pages; lift to popups/tooltips where useful.
- Preserve the new-vs-returning welcome greeting logic (commit `7511329`) when the greeting moves to Create Posts.

## Non-Goals

- **Post-publish data lifecycle.** "Posts leave the DB after publishing" is OUT of scope. Publishing itself is currently stubbed (`src/lib/services/posting-service.ts:6`); this redesign does not build on stubbed logic.
- **Quota model changes.** The "5 weeks per month" / quota-renaming work is a separate future project. This redesign keeps quota copy in batches.
- **Sidebar component primitives.** The sidebar component itself (visual + structural) is unchanged; only its item list, order, labels, and links are updated.
- **Image Library and Settings pages.** No functional or visual changes.
- **New tests.** Per `AGENTS.md`, no testing tasks unless the user requests them. Quality is enforced by lint / typecheck / build commands at the end of each wave.
- **NetworkWizard refactor.** The review/edit/regenerate UX moves to a new URL but the wizard internals are not redesigned.
- **Marketing / landing pages.** Out of scope.

## Acceptance Criteria

- [ ] Sidebar shows exactly these items, in this order: Create Posts, Schedule Posts, Posting Soon, Image Library, Settings, Cancelled Posts.
- [ ] `/dashboard` returns 404 (or 301 to `/create`); root `/` lands on `/create`.
- [ ] `/create` renders: welcome greeting (small, new-vs-returning logic intact) + "Create new posts" primary button + 3 stat boxes (real values, all users, always).
- [ ] Trial-used users see the same `/create` page as everyone else; the upgrade-required Dialog fires only on click of "Create new posts".
- [ ] After generation completes, the user lands at `/schedule-posts/[batchId]` in the review view.
- [ ] `/schedule-posts` lists in-flight (reviewing-status) batches; the per-batch detail at `/schedule-posts/[batchId]` is the existing NetworkWizard.
- [ ] `/posting-soon` shows scheduled batches with per-post cancel buttons and a "Select" mode toggle that enables bulk cancel via checkboxes + confirmation dialog.
- [ ] `/cancelled-posts` shows two sections: "Cancelled batches" (top) and "Cancelled single posts" (below); each with a row-level restore action.
- [ ] Single-post restore: if `scheduled_time > now`, calls `restorePost`; if past, opens a time-picker dialog before restoring.
- [ ] `/posts/currently-posting` route is deleted; sidebar no longer links there.
- [ ] Legacy URLs redirect: `/posts` → `/schedule-posts`, `/posts?batchId=X` → `/schedule-posts/X`, `/schedule` → `/posting-soon`, `/schedule/X` → `/posting-soon/X`, `/dashboard` → `/create`.
- [ ] "Batch" → "Week" sweep complete in friendly copy; quota copy still reads in batches.
- [ ] Onboarding completion lands new users on `/create`.
- [ ] `pnpm lint`, `pnpm typecheck` (or equivalent), and `next build` all pass at the end of every wave.

## Assumptions

- The PDF spec set (`C:\UniqueMe\UniqueMe pdf\`) describes a `/dashboard/*`-nested routing tree that the current app already departed from (it uses flat top-level routes). This redesign drifts further from the PDFs intentionally; the user has approved this drift.
- Stage-2 backend functions `postService.cancelPost(postId, platform?)` (`src/lib/services/post-service.ts:1721`) and `postService.restorePost(...)` (`src/lib/services/post-service.ts:1839`) are wired and behave per their Stage-2 spec.
- `scheduled_posts.status` enum values are `"pending" | "posted" | "failed" | "cancelled"` (`src/lib/schema.ts:665-669`). Cancelled rows remain in the DB; they are not deleted.
- `weeklyBatches.status` values include `"cancelled"` and cancelled batches keep their rows + child rows.
- The `currently_posting` derivedState in `BatchBoxData` is never written in Stage-1 code; deleting the dead state and `/posts/currently-posting` route is safe.
- "Posts Scheduled" stat = total count of `scheduled_posts` rows with `status='pending'` across all batches for the user (not just this week).
- "Connected accounts" stat = number of distinct connected social platforms (0–3 from FB / IG / LI), via the existing connected-accounts service.
- "Posts Created" stat = lifetime count via existing `postService.countTotalPostsCreated()`.
- Welcome greeting logic from commit `7511329` is currently in `dashboard/page.tsx`; the same logic moves to `create/page.tsx`.
- The top-bar trial pill (`dashboard/top-bar.tsx:93`) stays as the canonical trial-state surface across all pages.

## Technical Constraints

- **Stack:** Next.js App Router + React + TypeScript; Tailwind v4; shadcn/ui (new-york); Drizzle ORM.
- **Design system:** Every new UI element follows `DESIGN.md` (color tokens, type scale, radius, motion, button variants). Cards use `rounded-2xl p-8 shadow-soft`; primary buttons are `rounded-full h-11`; primary buttons on focal cards add `glow-champagne`; dialogs use `rounded-2xl shadow-float`.
- **Brand voice:** No exclamation points, no hyperbole, plain confident verbs. One sentence + one action for empty states.
- **Routing:** All renames use server-side redirects (`next.config.ts`) so external links and bookmarks survive. Path-based dynamic segments preferred over query strings for the new routes.
- **Per-wave gates:** `pnpm lint`, typecheck, and `next build` must pass before a wave is considered complete. Each wave must leave the app fully functional.
- **No DB schema changes.** This redesign uses existing tables, columns, and enum values. If a wave appears to need a schema change, escalate before adding one (and follow `AGENTS.md`'s drizzle generate-then-migrate rule).
- **No new dependencies.** Use existing shadcn primitives (Dialog, Checkbox, Calendar/DatePicker if present) and existing service-layer functions.
- **Auto-memory rule (per user memory):** Before any wave starts implementation, the wave's locked-in build prompt must be saved to `prompts/{slug}.md`. The folder is git-ignored.
- **Self-test handoff (per user memory):** Each wave's PR must include a 5-check handoff (gates / data-source reality / spec match / cross-page consistency / what I could not verify).
