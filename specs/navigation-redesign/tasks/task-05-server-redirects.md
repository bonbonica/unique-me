# Task 05: Server-side redirects for legacy routes

## Status

pending

## Wave

1

## Description

External links, bookmarks, and (in some cases) cached app links still point at the old route paths. Add `next.config.ts` redirects so the old URLs land on the new ones without a broken-link experience. This is the single owner of `next.config.ts` for the wave; other Wave 1 tasks do not touch this file.

The Wave 3 dashboard deletion (task-08) will add its own `/dashboard → /create` redirect. This task does NOT add that redirect, because `/dashboard` is still a live route in Wave 1.

## Dependencies

**Depends on:** task-01 (so `/posting-soon` exists as a destination), task-02 (so `/schedule-posts/[batchId]` exists as a destination)
**Blocks:** task-06 (Wave 2 assumes legacy URLs already redirect)

**Context from dependencies:** task-01 creates `/posting-soon` and `/posting-soon/[batchId]`. task-02 creates `/schedule-posts` and `/schedule-posts/[batchId]` and changes the generator's internal `redirect()` call to use the new path. After this task, anyone hitting `/posts`, `/posts?batchId=X`, `/schedule`, `/schedule/X`, or `/posts/currently-posting` 301s to the right new location.

## Files to Create

None.

## Files to Modify

- `next.config.ts` — add a `redirects()` async function returning the rules below.

## Files to Delete

- `src/app/(app)/(onboarded)/posts/page.tsx` — after the redirect is in place, this file is unreachable; delete it so it doesn't drift. (Next.js processes `redirects()` from config before route resolution, so the redirect wins even if the file exists, but keeping a dead route file invites bitrot.)
- The empty `src/app/(app)/(onboarded)/posts/` folder if no other files remain in it after deletion. (task-04 already removed `posts/currently-posting/`; this task removes `posts/page.tsx`. If those were the only files, delete the parent folder too.)

## Technical Details

### Implementation Steps

1. Open `next.config.ts` (current contents shown in dependencies context). Add an `async redirects()` method to the exported config object.
2. Add these rules (order matters — more specific rules first):

   | source | destination | permanent |
   |---|---|---|
   | `/posts/currently-posting` | `/posting-soon` | true |
   | `/posts` (with `has: query batchId`) | `/schedule-posts/:batchId` | true |
   | `/posts` | `/schedule-posts` | true |
   | `/schedule/:batchId` | `/posting-soon/:batchId` | true |
   | `/schedule` | `/posting-soon` | true |

3. Delete `src/app/(app)/(onboarded)/posts/page.tsx`. If the `posts/` folder is now empty, delete the folder.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`. Verify the dev server picks up the redirects after restart.
5. Dev-server smoke test:
   - Navigate to `/posts` → lands at `/schedule-posts` (301).
   - Navigate to `/posts?batchId=abc-123` → lands at `/schedule-posts/abc-123` (301).
   - Navigate to `/schedule` → lands at `/posting-soon`.
   - Navigate to `/schedule/abc-123` → lands at `/posting-soon/abc-123`.
   - Navigate to `/posts/currently-posting` → lands at `/posting-soon`.

### Code Snippets

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ...existing image / compress / headers config unchanged...

  async redirects() {
    return [
      {
        source: "/posts/currently-posting",
        destination: "/posting-soon",
        permanent: true,
      },
      {
        source: "/posts",
        has: [{ type: "query", key: "batchId", value: "(?<id>.*)" }],
        destination: "/schedule-posts/:id",
        permanent: true,
      },
      {
        source: "/posts",
        destination: "/schedule-posts",
        permanent: true,
      },
      {
        source: "/schedule/:batchId",
        destination: "/posting-soon/:batchId",
        permanent: true,
      },
      {
        source: "/schedule",
        destination: "/posting-soon",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
```

### Notes on what NOT to change

- Do NOT add a `/dashboard → /create` redirect in this task — `/dashboard` is still a live route in Wave 1. task-08 (Wave 3) adds that redirect when it deletes the dashboard.
- Do NOT touch the existing `headers()`, `images.remotePatterns`, or `compress` configs. Add `redirects()` alongside them.
- Do NOT delete the `/schedule-posts` or `/posting-soon` files — they are the new destinations.

## Acceptance Criteria

- [ ] `next.config.ts` exports a config with a `redirects()` function returning the 5 rules above, in the specified order, all `permanent: true`.
- [ ] `src/app/(app)/(onboarded)/posts/page.tsx` is deleted. The `posts/` folder is deleted if empty.
- [ ] Dev server: navigating to each legacy URL above 301s to the new URL with the path/query preserved correctly.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- The query-to-path redirect (`/posts?batchId=X` → `/schedule-posts/X`) uses Next.js's `has` clause with a named capture group `(?<id>.*)` and references it as `:id` in destination. This is a documented Next.js feature; if the implementation hits a snag (e.g. Next.js version doesn't support named capture in `has`), an acceptable fallback is to leave `/posts/page.tsx` in place as a server component that reads `searchParams.batchId` and calls `redirect(\`/schedule-posts/\${batchId}\`)`. Document whichever approach is used in the task notes when handing back.
- Setting `permanent: true` (308) is intentional — these URL changes are durable. If we ever want to undo them, we explicitly remove the rule.
