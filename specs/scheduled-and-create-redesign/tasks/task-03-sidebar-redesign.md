# Task 03: Sidebar redesign — drop "My Posts", rename "Schedule"

## Status
not started

## Wave
2

## Description

Remove the "My Posts" item from the sidebar and rename "Schedule" → "Scheduled" (label change only — the route stays `/schedule`). The `/posts` route remains accessible to deep links from cards on Create Posts and to bookmarks; it's just no longer top-level navigation.

## Dependencies

**Depends on:** none.
**Blocks:** task-12 (lint/typecheck audit — confirms `FileText` import is cleaned up).
**Parallel with:** task-04 (different file).

## Files to Modify

- `src/components/dashboard/sidebar.tsx` (modified) — edit `DASHBOARD_NAV_ITEMS`.

## Implementation Steps

### 1. Update the nav items const

In `sidebar.tsx:30–36`, change:

```ts
export const DASHBOARD_NAV_ITEMS: readonly NavItem[] = [
  { label: "Create Posts", href: "/create", icon: Sparkles },
  { label: "My Posts", href: "/posts", icon: FileText },
  { label: "Image Library", href: "/library", icon: ImageIcon },
  { label: "Schedule", href: "/schedule", icon: Calendar },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;
```

to:

```ts
export const DASHBOARD_NAV_ITEMS: readonly NavItem[] = [
  { label: "Create Posts", href: "/create", icon: Sparkles },
  { label: "Image Library", href: "/library", icon: ImageIcon },
  { label: "Scheduled", href: "/schedule", icon: Calendar },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;
```

### 2. Remove the unused import

Drop `FileText` from the `lucide-react` import (line 5–11). If `FileText` is used elsewhere in the file, leave it. If unused project-wide after this change, the unused-import lint rule will catch it.

### 3. Confirm `isActive` still does the right thing for `/posts`

The `isActive(pathname, href)` function (sidebar.tsx:42–44) does prefix-aware matching. With "My Posts" gone, visiting `/posts/{batchId}/review` no longer highlights any sidebar item — that's intentional. The Create Posts item highlights only when the user is on `/create` or `/create/*`. **No code change needed**; this is documented for the reviewer.

### 4. Do NOT change the route

`href: "/schedule"` is unchanged. Only the visible `label` becomes `"Scheduled"`. This avoids a redirect, a `next.config.js` rewrite, and a Lighthouse impact on saved URLs.

## Acceptance Criteria

- [ ] `DASHBOARD_NAV_ITEMS` has exactly four items in the order: Create Posts, Image Library, Scheduled, Settings.
- [ ] The "Scheduled" item points to `/schedule` (route unchanged).
- [ ] `FileText` is no longer imported in `sidebar.tsx`.
- [ ] Active-state highlighting works for the four remaining items.
- [ ] Visiting `/posts` or `/posts/{batchId}` no longer highlights any sidebar item.
- [ ] Mobile drawer (`<DashboardNavList />` consumed by both desktop and mobile) shows the same four items.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The `isActive` function (sidebar.tsx:42–44) is intentionally prefix-aware. With "My Posts" removed, the prefix logic now only matters for `/create/*` and `/library/*` nested routes if they ever appear; today they don't.
- A future spec may rename `/schedule` → `/scheduled` for URL consistency. That's a route change with redirect implications and is **out of scope** for this task — only the label changes here.

## Out of scope

- Route rename `/schedule` → `/scheduled`.
- Replacing the `Calendar` icon with a different Lucide icon.
- Visual changes to the sidebar (active-state styling, padding, etc.).
- Mobile drawer copy or layout changes beyond the items list.
