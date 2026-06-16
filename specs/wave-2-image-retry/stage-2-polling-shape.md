# Stage 2 — Polling shape extension

**Goal:** the polling channel carries `attempt` and treats `'regenerating'` as a pending state. No new UI behaviour in this stage — but Stage 3 and 4 will read `attempt` and `'regenerating'` from this channel.

Read `spec.md` first.

**Prereq:** Stage 1 must be committed and the build green.

---

## Files to touch

1. `src/app/(app)/(onboarded)/posts/actions.ts` — extend `getBatchImageStatusesAction` SELECT
2. `src/components/posts/network-wizard.tsx` — extend `PostImageStatus` type, extend `anyPending` predicate

The exact type name / file location for `PostImageStatus` may differ — grep the codebase for `PostImageStatus` to find the canonical declaration. There should be one.

---

## Steps

### 1. Extend `PostImageStatus`

Find the type definition (one of `network-wizard.tsx`, `post-tile-image.tsx`, or a shared `types.ts` near them). Extend:

```ts
// Before
type PostImageStatus = {
  status: 'pending' | 'generating' | 'success' | 'failed';
  imageUrl: string | null;
}

// After
type PostImageStatus = {
  status: 'pending' | 'generating' | 'success' | 'failed' | 'regenerating';
  imageUrl: string | null;
  attempt: number;
}
```

If the type is structurally inferred from a Drizzle row, update the SELECT shape to include `attempt` so the inferred type carries it.

### 2. Extend `getBatchImageStatusesAction`

Located in `src/app/(app)/(onboarded)/posts/actions.ts` (Wave 1 added it). The current SELECT returns `{ status, imageUrl }` per row. Add `attempt`:

```ts
// Inside the select object
attempt: postImages.attempt,
```

No filtering changes — still filtered by `batchId` + ownership via `posts.userId = sessionUserId`.

### 3. Extend `anyPending`

In `src/components/posts/network-wizard.tsx`, locate the `anyPending` helper. Wave 1 returns `true` if any tile has status `pending` or `generating`. Extend to also include `regenerating`:

```ts
// Before
const anyPending = (images: Record<string, PostImageStatus>) =>
  Object.values(images).some(
    (img) => img.status === 'pending' || img.status === 'generating'
  );

// After
const anyPending = (images: Record<string, PostImageStatus>) =>
  Object.values(images).some(
    (img) =>
      img.status === 'pending' ||
      img.status === 'generating' ||
      img.status === 'regenerating'
  );
```

The exact form may be a `.some()` over a different shape — match the existing code. The intent: polling continues while any tile is in any non-terminal state.

---

## Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run build` all pass.
2. Existing Wave 1 polling still works (initial batch gen → tiles transition from skeleton to image). No regression.
3. Manual verification: in dev, manually set a row to `status='regenerating'` in the DB, open the review page, and confirm:
   - Polling starts (network tab shows the action being called every 2.5s).
   - Polling stops when you manually update the row back to `success`.
4. `PostImageStatus` consumers all type-check — grep for the type name and verify every reader handles `regenerating` and reads `attempt` if needed. TypeScript will surface any holes.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT add any UI rendering for `'regenerating'` yet — that's Stage 4.
- Do NOT add retry/regenerate buttons — that's Stage 3 and 4.
- Do NOT change the poll interval.
- Do NOT add the "kept original" toast detection — that's Stage 4.
- Do NOT modify the server actions added in Stage 1.
