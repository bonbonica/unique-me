# Task 03: Create /cancelled-posts shell

## Status

pending

## Wave

1

## Description

Create a new `/cancelled-posts` route as the home for cancelled batches and cancelled single posts. This task builds only the **page shell**: route file, page title, two empty section headers ("Cancelled batches" and "Cancelled single posts"), and tasteful empty-state copy in each section. Population of section 1 is task-06 (Wave 2); population of section 2 is task-11 (Wave 4). The shell lets task-04 link the sidebar entry to a real route and lets Wave 2 build on top of the structure without inventing it from scratch.

## Dependencies

**Depends on:** None (Wave 1)
**Blocks:** task-04 (sidebar entry for Cancelled Posts needs a destination), task-06 (section 1 population), task-11 (section 2 population)

**Context from dependencies:** None. This is a Wave 1 starter task.

## Files to Create

- `src/app/(app)/(onboarded)/cancelled-posts/page.tsx` — server component, renders the page shell with two empty sections.

## Files to Modify

None.

## Technical Details

### Implementation Steps

1. Create `src/app/(app)/(onboarded)/cancelled-posts/page.tsx` as a server component.
2. Layout follows the editorial-content pattern from `DESIGN.md` § 8 Pattern B:
   - Wrapper: `container mx-auto px-5 sm:px-8 lg:px-12`
   - Inner: `max-w-3xl mx-auto space-y-8`
3. Page title (Fraunces): `<h1 className="text-3xl font-medium tracking-tight">Cancelled Posts</h1>`. Below it, a single muted sentence: `<p className="text-base text-muted-foreground leading-7">Cancelled batches and single posts. Restore any of them from here.</p>`. No more inline text than that.
4. Two sections, each `bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4`:
   - Section 1 header: `<h2 className="text-2xl font-medium tracking-tight font-fraunces">Cancelled batches</h2>` (Fraunces). For now, empty-state placeholder: `<p className="text-sm text-muted-foreground">Nothing cancelled.</p>`. task-06 replaces the placeholder with real rows.
   - Section 2 header: `<h2 className="text-2xl font-medium tracking-tight font-fraunces">Cancelled single posts</h2>`. Empty-state placeholder: `<p className="text-sm text-muted-foreground">Nothing cancelled.</p>`. task-11 replaces the placeholder.
5. Wrap each section's contents in a stable container that task-06 and task-11 can target by file (e.g. a `<CancelledBatchesSection />` and `<CancelledSinglePostsSection />` placeholder component file, OR a clearly-commented JSX block in `page.tsx` like `{/* CANCELLED_BATCHES_SECTION: populated by task-06 */}`). The component-file approach is preferred because it avoids a file-conflict with task-04/05/etc. — create the placeholder component files as empty server-component renders that just return the placeholder `<p>`.
6. Optional but recommended file structure:
   - `src/app/(app)/(onboarded)/cancelled-posts/page.tsx`
   - `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-batches-section.tsx` (placeholder)
   - `src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-single-posts-section.tsx` (placeholder)
7. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
8. Dev-server check: navigate to `/cancelled-posts`, confirm the page renders with two empty sections. No console errors.

### Code Snippets

Section component placeholder:

```tsx
// src/app/(app)/(onboarded)/cancelled-posts/_components/cancelled-batches-section.tsx
export async function CancelledBatchesSection() {
  return (
    <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4">
      <h2 className="text-2xl font-medium tracking-tight font-fraunces">Cancelled batches</h2>
      <p className="text-sm text-muted-foreground">Nothing cancelled.</p>
    </section>
  );
}
```

Page shell:

```tsx
// src/app/(app)/(onboarded)/cancelled-posts/page.tsx
import { CancelledBatchesSection } from "./_components/cancelled-batches-section";
import { CancelledSinglePostsSection } from "./_components/cancelled-single-posts-section";

export default async function CancelledPostsPage() {
  return (
    <div className="container mx-auto px-5 sm:px-8 lg:px-12">
      <div className="max-w-3xl mx-auto space-y-8 py-12 sm:py-16">
        <header className="space-y-2">
          <h1 className="text-3xl font-medium tracking-tight font-fraunces">Cancelled Posts</h1>
          <p className="text-base text-muted-foreground leading-7">
            Cancelled batches and single posts. Restore any of them from here.
          </p>
        </header>
        <CancelledBatchesSection />
        <CancelledSinglePostsSection />
      </div>
    </div>
  );
}
```

### Notes on what NOT to change

- Do not add the sidebar entry for Cancelled Posts here — task-04 owns the sidebar.
- Do not add any data fetching yet — sections are empty placeholders.
- Do not add a redirect for any old `/cancelled` path; there isn't one today.

## Acceptance Criteria

- [ ] `/cancelled-posts` renders without errors with the page title and two empty section cards.
- [ ] Each section has its header text styled per `DESIGN.md` (Fraunces, `tracking-tight`, weight 500).
- [ ] Empty-state copy in each section is one short sentence with no exclamation points.
- [ ] Section components are split into `_components/` files (or another structural choice that lets task-06 and task-11 swap in real renderings without touching `page.tsx`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

The `_components` underscore folder convention prevents Next.js from treating those files as routable pages — confirm that the project uses this convention or an equivalent (some Next.js codebases use `src/components/cancelled-posts/...` instead; follow project convention).
