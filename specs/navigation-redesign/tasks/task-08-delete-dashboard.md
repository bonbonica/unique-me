# Task 08: Delete /dashboard + root redirect + onboarding redirect + remove NextBatchBanner

## Status

pending

## Wave

3

## Description

Delete the `/dashboard` route entirely. Root (`/`) lands on `/create`. Onboarding completion now routes to `/create` instead of `/dashboard`. The `NextBatchBanner` component (dashboard-only quota banner) is removed. The top-bar trial pill stays (it's the canonical trial-state surface across all pages). The welcome-greeting logic (new vs returning, shipped in commit `7511329`) is NOT deleted in this task — task-09 carries the same logic into the rebuilt `/create` page. Coordinate with task-09 so the logic survives the dashboard's removal.

## Dependencies

**Depends on:** task-06, task-07 (so cancelled batches have their new home and `/create` is clean before being rebuilt)
**Blocks:** task-10, task-11 (Wave 4 builds on a stable Wave 3 routing baseline)

**Context from dependencies:** task-06 populated `/cancelled-posts` with cancelled batches. task-07 confirmed `/create` no longer surfaces cancelled batches. `/create` still has its old form-based layout from Waves 1–2; task-09 (this task's parallel sibling) rebuilds it into the new Create Posts surface with the welcome greeting + button + 3 stats + trial Dialog. **Coordinate with task-09 on the welcome-greeting logic** (see "Notes" below).

## Files to Create

None.

## Files to Modify

- `next.config.ts` — add `/dashboard → /create` permanent redirect to the `redirects()` array (task-05 created the array; add to it).
- `src/app/page.tsx` (or wherever the root `/` route lives) — change the root redirect target from `/dashboard` to `/create`. If the root currently 30x's to `/dashboard`, that change goes here. If root is a public landing page that links to `/dashboard` for authenticated users, change the authenticated-user destination.
- The post-onboarding redirect target — search for `redirect("/dashboard")` and `redirect(\`/dashboard\`)` across `src/`. Most likely in `src/app/(app)/onboarding/...` or in an onboarding-completion server action. Change to `redirect("/create")`.
- `src/components/dashboard/top-bar.tsx` — if it imports or computes anything that depended on the dashboard's existence, clean up. (The trial pill itself stays.)

## Files to Delete

- `src/app/(app)/(onboarded)/dashboard/page.tsx` — the page itself.
- Any sibling files in `dashboard/` (loading.tsx, error.tsx if present).
- The empty `dashboard/` folder.
- `src/components/dashboard/next-batch-banner.tsx` — the NextBatchBanner component file. Confirm via grep that no other file imports it.
- Any other component file that exists exclusively to render dashboard chrome (welcome card variants, etc.). Coordinate with task-09: the welcome-greeting logic is NOT a "delete" — it's a "move" (see Notes).

## Technical Details

### Implementation Steps

1. **Confirm welcome-greeting logic location.** Read `src/app/(app)/(onboarded)/dashboard/page.tsx` lines ~190–197 (per exploration). The logic is: `Welcome, {firstName}.` for new users, `Welcome back, {firstName}.` for returning. Extract this into a small helper or shared component (e.g. `src/components/welcome-greeting.tsx`) so task-09 can use it. **Create this helper in this task** so task-09 imports it. Helper signature:

   ```tsx
   // src/components/welcome-greeting.tsx
   export function WelcomeGreeting({ firstName, isReturning }: { firstName: string; isReturning: boolean }) {
     return (
       <p className="text-sm text-muted-foreground">
         {isReturning ? `Welcome back, ${firstName}.` : `Welcome, ${firstName}.`}
       </p>
     );
   }
   ```

   And expose whatever server-side `isReturning` derivation lives in today's dashboard page as a callable helper (e.g. `getIsReturningUser(userId)`) so task-09 can call it.
2. **Delete the dashboard route.** Remove `src/app/(app)/(onboarded)/dashboard/page.tsx` and any sibling files. Delete the empty folder.
3. **Delete `NextBatchBanner`.** Remove `src/components/dashboard/next-batch-banner.tsx`. Grep for `NextBatchBanner` and `next-batch-banner` across `src/` and confirm zero remaining references.
4. **Update root redirect.** Find the root `/` route. If it's a `src/app/page.tsx`:
   - If it does `redirect("/dashboard")` for authenticated users, change to `redirect("/create")`.
   - If it renders a public landing page and routes auth'd users via middleware, find that middleware.
   - If it doesn't exist (the project's root might be a marketing page that doesn't redirect), add a minimal authenticated-user redirect to `/create` in the appropriate place.
5. **Update post-onboarding redirect.** Search `src/` for `"/dashboard"` and `'/dashboard'` (string literals). Hits are likely in:
   - Onboarding completion server action (e.g. `src/app/(app)/onboarding/.../actions.ts` or `src/lib/services/onboarding-service.ts`)
   - Middleware (`src/middleware.ts`) — auth-redirect destinations
   - Any "Go to dashboard" links in toasts or success messages
   - Replace with `/create`.
6. **Add the next.config redirect.** Append to the `redirects()` array from task-05:

   ```ts
   {
     source: "/dashboard",
     destination: "/create",
     permanent: true,
   },
   ```

7. **Clean up dead helpers.** If `getCurrentlyPostingBatch` (post-service.ts:442) was kept alive in Wave 1 because of dashboard usage, grep for callers now and delete the helper if there are none. Also clean any other dashboard-specific selectors / queries left orphaned.
8. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`. Address any unused-import or undefined-export errors from the deletions.
9. Dev-server smoke test:
   - Navigate to `/` → lands at `/create` (for authenticated users).
   - Navigate to `/dashboard` → 301s to `/create`.
   - Complete an onboarding flow as a new user → lands at `/create`.

### Notes on what NOT to change

- Do not touch the top-bar trial pill — it's the canonical trial-state UI surface and stays as-is across all pages.
- Do not modify `/create`'s page contents in this task — task-09 owns the rebuild. If your work here forces a tiny change in `/create` (e.g. removing an import the page no longer needs because a helper moved), keep that change minimal and document it.
- Do not delete the `dashboard/` folder under `src/components/` — `sidebar.tsx` and `top-bar.tsx` live there and stay. Only the route folder under `src/app/(app)/(onboarded)/dashboard/` is deleted.

## Acceptance Criteria

- [ ] `src/app/(app)/(onboarded)/dashboard/` directory is fully removed.
- [ ] `next.config.ts` has a permanent redirect from `/dashboard` to `/create`.
- [ ] Root `/` for authenticated users lands on `/create`.
- [ ] Onboarding completion routes to `/create` (verify by reading every changed file and grepping for residual `/dashboard` strings).
- [ ] `NextBatchBanner` component file deleted; no remaining imports of it.
- [ ] `WelcomeGreeting` helper component exists at `src/components/welcome-greeting.tsx` with the new-vs-returning logic and is exported for task-09 to import.
- [ ] Top-bar trial pill still appears on all authenticated pages with the same behavior as before.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- **Coordination with task-09:** This task creates `WelcomeGreeting` and exposes a server helper for `isReturning`. task-09 imports both. The two tasks should be in the same wave PR; if implemented sequentially, run this one first.
- The user explicitly approved deleting `/dashboard` with no replacement landing page — the redesign treats `/create` as the new "home".
- The dashboard's quota-state surface (NextBatchBanner) goes away with no direct replacement. The top-bar trial pill carries the trial-state info; Pro-user quota state during the redesign lives only inside the click-time trial Dialog and the existing `<CreateNextBatchCta>` (if still in use). If the user later wants quota state visible on Create Posts, that's a separate task.
