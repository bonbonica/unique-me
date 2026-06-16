# Stage 1 — Schema + backend

**Goal:** ship the backend foundation. After this stage, the database can hold a `'regenerating'` status, two server actions exist, and a single-row service runner exists. **No UI changes in this stage.**

Read `spec.md` first for full context.

---

## Files to touch

1. `src/lib/schema.ts` — extend status union
2. `drizzle/...` — generate migration
3. `src/lib/services/image-service.ts` — add `runImageGenerationForRow`
4. `src/app/(app)/(onboarded)/posts/actions.ts` — add `retryImageAction` + `regenerateImageAction`

---

## Steps

### 1. Schema

`src/lib/schema.ts` — locate the `post_images` table (around line 340). Update the inline-typed union comment AND any exported `PostImageStatus` type to include `'regenerating'`:

```ts
// Before
status: text("status").notNull().default("pending"),
// Union: "pending" | "generating" | "success" | "failed"

// After
status: text("status").notNull().default("pending"),
// Union: "pending" | "generating" | "success" | "failed" | "regenerating"
```

Search for any exported TypeScript union (e.g., `PostImageStatus['status']` or similar) and extend it. The column is a plain `text` — no CHECK constraint — so this is a type-only change at the SQL layer.

### 2. Migration

```
npm run db:generate    # or whatever the project's drizzle generate script is
npm run db:migrate     # apply
```

The migration may be metadata-only (no DDL diff). That is expected and correct — record it for audit trail anyway.

**NEVER run `drizzle push`** (per `AGENTS.md`).

### 3. Service runner

`src/lib/services/image-service.ts` — add a new function alongside `runImageGenerationForBatch`:

```ts
import { after } from "next/server";  // (already imported via Wave 1 path — verify)

export async function runImageGenerationForRow(
  postImageId: string,
  mode: 'retry' | 'regenerate',
): Promise<void> {
  // 1. SELECT the row joined with posts (for userId) and weekly_batches
  //    (for batchImageStyle). Use the same join pattern as
  //    runImageGenerationForBatch.
  //
  //    Required columns: id, imagePrompt, status, attempt.
  //
  // 2. If row missing, log and return.
  //
  // 3. Call generateImage({ combinedPrompt: row.imagePrompt }).
  //    Wave 1 stores the COMBINED prompt in post_images.imagePrompt, so
  //    no re-derivation is needed.
  //
  // 4. Outcome dispatch:
  //
  //    Success (image generated + Blob upload succeeded):
  //      UPDATE post_images SET status='success', imageUrl=<blobUrl>
  //        WHERE id=<postImageId>
  //
  //    Failure, mode='retry':
  //      UPDATE post_images SET status='failed'
  //        WHERE id=<postImageId>
  //
  //    Failure, mode='regenerate':
  //      UPDATE post_images SET status='success'
  //        WHERE id=<postImageId>
  //      (imageUrl is NOT touched — original is preserved)
  //
  // 5. All errors caught + logged. NEVER throws.
}
```

**Important:** no `pLimit` — this is single-row. Don't import it.

**Blob upload:** reuse `upload(buffer, filename, prefix)` from `src/lib/storage.ts` exactly as Wave 1 does in `runImageGenerationForBatch`. Filename `${postImageId}.png`, prefix `post-images/${batchId}` — same as Wave 1. Overwrite or append a timestamp suffix per however Wave 1 handles re-uploads (verify Wave 1's exact behaviour and match it).

### 4. Server actions

`src/app/(app)/(onboarded)/posts/actions.ts` — add two new exports.

```ts
"use server";

import { after } from "next/server";
import { db } from "@/lib/db";
import { postImages } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { runImageGenerationForRow } from "@/lib/services/image-service";
import { subscriptionService } from "@/lib/services/subscription-service";
// ...existing imports

export async function retryImageAction(
  postImageId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_owned' | 'not_failed' | 'attempts_exhausted' | 'already_in_progress' }
> {
  // 1. Resolve session userId (use the project's existing session helper —
  //    grep for "sessionUserId" or "auth()" usage in this same file).
  //    If unauthenticated → return { ok: false, reason: 'not_owned' }.
  //
  // 2. Conditional UPDATE:
  //      UPDATE post_images
  //      SET status='generating', attempt=2
  //      WHERE id = postImageId
  //        AND userId = sessionUserId
  //        AND status = 'failed'
  //        AND attempt = 1
  //      RETURNING id;
  //
  // 3. If 0 rows returned, re-SELECT to determine reason:
  //      - row missing → 'not_owned'
  //      - userId mismatch → 'not_owned'
  //      - status != 'failed' → 'not_failed'
  //      - attempt >= 2 → 'attempts_exhausted'
  //      - status in ('generating','regenerating') → 'already_in_progress'
  //
  // 4. after(() => runImageGenerationForRow(postImageId, 'retry'));
  //
  // 5. return { ok: true }
}

export async function regenerateImageAction(
  postImageId: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_owned' | 'not_successful' | 'attempts_exhausted' | 'already_in_progress' | 'pro_required' }
> {
  // 1. Resolve session userId.
  //
  // 2. Tier gate (BEFORE any DB write):
  //      const sub = await subscriptionService.checkSubscription(userId);
  //      if (!(sub.plan === 'pro' && sub.status === 'active')) {
  //        return { ok: false, reason: 'pro_required' };
  //      }
  //
  // 3. Conditional UPDATE:
  //      UPDATE post_images
  //      SET status='regenerating', attempt=2
  //      WHERE id = postImageId
  //        AND userId = sessionUserId
  //        AND status = 'success'
  //        AND attempt = 1
  //      RETURNING id;
  //    DO NOT clear imageUrl.
  //
  // 4. If 0 rows: re-SELECT, map reason ('not_owned' / 'not_successful' /
  //    'attempts_exhausted' / 'already_in_progress').
  //
  // 5. after(() => runImageGenerationForRow(postImageId, 'regenerate'));
  //
  // 6. return { ok: true }
}
```

---

## Acceptance criteria

1. `npm run lint`, `npm run typecheck`, `npm run build` all pass.
2. Migration applied (verify with `drizzle migrate` output or by inspecting the migrations table).
3. Manual smoke test via a temporary route or `node` script:
   - Insert a `post_images` row with `status='failed'`, `attempt=1`. Call `retryImageAction` with the row id. Verify status → `generating` → `success` or `failed` within ~10s, attempt = 2.
   - Same with a `status='success'` row → call `regenerateImageAction` → verify regenerating → success (new imageUrl) OR success (imageUrl unchanged on OpenAI failure), attempt = 2.
   - Call either action a second time on the same row → expect `attempts_exhausted`.
   - Call `regenerateImageAction` as a non-Pro user → expect `pro_required`.
4. No Wave 1 regressions — initial batch gen still works end-to-end.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT modify `post-tile-image.tsx`.
- Do NOT modify `network-wizard.tsx`.
- Do NOT touch `getBatchImageStatusesAction` (Stage 2 owns that).
- Do NOT add a retry/regenerate button anywhere in the UI.
- Do NOT add new toast copy.
- Do NOT add a third attempt cap or any "soft limit" — the 2-cap is hardcoded.
- Do NOT modify `runImageGenerationForBatch` — Wave 1's batch path stays exactly as-is.
- Do NOT introduce a new `mode` parameter on the existing batch function or refactor it. Keep the new function alongside.
