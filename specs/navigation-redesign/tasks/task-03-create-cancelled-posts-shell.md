# Task 03: Create /cancelled-posts shell

## Status

pending

## Wave

1

## Description

Create a new `/cancelled-posts` route as the home for cancelled posts. This task builds only the **page shell**: route file, page title, lead sentence, and ONE empty list-section ("Cancelled posts") with a placeholder empty-state ("Nothing cancelled."). Population of the list is task-11 (Wave 4). The shell lets task-04 link the sidebar entry to a real route and lets Wave 4 build on top of the structure without inventing it from scratch.

**Design (locked-in 2026-06-19):** the Cancelled Posts page is ONE list of individual cancelled posts. There is no separate "Cancelled batches" section — when a whole batch is cancelled, each of its scheduled posts surfaces here individually. This task creates a single section component (not two).

## Dependencies

**Depends on:** None (Wave 1)
**Blocks:** task-04 (sidebar entry for Cancelled Posts needs a destination), task-11 (single list population)

**Context from dependencies:** None. This is a Wave 1 starter task.

## Files to Create

- `src/app/(app)/(onboarded)/cancelled-posts/page.tsx` — server component, renders the page shell with one empty list section.
- `src/components/cancelled-posts/cancelled-posts-list.tsx` — single section component (placeholder body for now; task-11 replaces the body).

## Files to Modify

None.

## Technical Details

### Implementation Steps

1. Create `src/components/cancelled-posts/cancelled-posts-list.tsx` as a server component exporting `CancelledPostsList()`. Body for Wave 1:
   - Section wrapper: `bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4`
   - Heading: `<h2 className="font-fraunces text-2xl font-medium tracking-tight">Cancelled posts</h2>`
   - Empty-state: `<p className="text-sm text-muted-foreground">Nothing cancelled.</p>`
2. Create `src/app/(app)/(onboarded)/cancelled-posts/page.tsx` as a server component.
3. Page layout follows the editorial-content pattern from `DESIGN.md` § 8 Pattern B:
   - Wrapper inside the existing onboarded layout: `<div className="max-w-3xl mx-auto space-y-8">`
4. Page title (Fraunces): `<h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">Cancelled Posts</h1>`. Below it, a single muted sentence: `<p className="text-base text-muted-foreground leading-7">Cancelled posts. Repost any of them from here.</p>`. No more inline text than that.
5. Render `<CancelledPostsList />` directly under the header.
6. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
7. Dev-server check: navigate to `/cancelled-posts`, confirm the page renders with title + lead + one empty section. No console errors.

### Code Snippets

Section component:

```tsx
// src/components/cancelled-posts/cancelled-posts-list.tsx
export function CancelledPostsList() {
  return (
    <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4">
      <h2 className="font-fraunces text-2xl font-medium tracking-tight">
        Cancelled posts
      </h2>
      <p className="text-sm text-muted-foreground">Nothing cancelled.</p>
    </section>
  );
}
```

Page shell:

```tsx
// src/app/(app)/(onboarded)/cancelled-posts/page.tsx
import { CancelledPostsList } from "@/components/cancelled-posts/cancelled-posts-list";

export default function CancelledPostsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Cancelled Posts
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Cancelled posts. Repost any of them from here.
        </p>
      </header>
      <CancelledPostsList />
    </div>
  );
}
```

### Notes on what NOT to change

- Do not add the sidebar entry for Cancelled Posts here — task-04 owns the sidebar.
- Do not add any data fetching yet — section is an empty placeholder.
- Do not add a redirect for any old `/cancelled` path; there isn't one today.
- Do not create two sections — the single-list design is locked-in.

## Acceptance Criteria

- [ ] `/cancelled-posts` renders without errors with the page title, lead sentence, and one empty list section.
- [ ] Section header text is styled per `DESIGN.md` (Fraunces, `tracking-tight`, weight 500).
- [ ] Empty-state copy is one short sentence with no exclamation points.
- [ ] Section is split into a component file (`cancelled-posts-list.tsx`) so task-11 can swap in the real rendering without touching `page.tsx`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.
