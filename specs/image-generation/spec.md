# Image Generation — Wave 1 spec

**Goal:** make one AI image appear on each post in a generated batch, with batch-wide visual consistency, so the user sees an image on every post tile by the time they reach review. One image per post. Same visual style across the 7-9 posts so the set feels like one photographer shot it.

**Scope:** schema + provider abstraction + caption-call schema extension + post-commit fan-out + minimal display states. Nothing else.

---

## Out of scope — future waves

These are deferred. The schema and architecture in this wave must not block them.

| Wave | What |
|---|---|
| **Wave 2** | Retry control on a failed image. 2-attempt cap (`attempt` column already exists, max 3). "Permanent once successful" lock — a `status="success"` row is never overwritten by a retry. |
| **Wave 3** | User deletes the AI image and uploads their own. Blob is deleted from Vercel Blob after a successful publish to social platforms. |
| **Wave 4** | Cross-period retention / purge — keep current-period batches + the 3 most recent from the previous period. Computed off `subscription.periodStartDate` via `computeCurrentPeriodStart`. |

---

## PDF alignment notes (per memory rule — surface conflicts with prior decisions)

Loaded `UniqueMe_App_Vision_and_Architecture.pdf` and `Service_Layer_Commands_UniqueMe.pdf` before drafting.

1. **Image provider divergence.** Vision PDF §4 names **Gemini Imagen** (~$0.03/image, "cheapest, start here"). This spec selects **OpenAI GPT Image 1.5**. Justification belongs in the implementation decision log — this wave proceeds with OpenAI as the user has chosen. The provider-abstraction layer below keeps a swap viable.
2. **Image-flow simplification for Wave 1.** Vision PDF §6 describes the *eventual* flow as "AI generates → Accept / Regenerate (up to 3 on Pro) / Upload own / Skip". Wave 1 ships only "AI generates" — no accept gate, no regenerate UI, no upload, no skip. Each post just *has* the image we generated. The other branches arrive in Waves 2-3.
3. **Batch-wide consistency is a new refinement.** No prior PDF mentions a shared style across the set. This spec introduces it via a `batchImageStyle` field returned by the same caption call. Aligns with the vision (cohesive brand presence) without contradicting it.
4. **Service-layer convention preserved.** Service Layer PDF defines `imageService.generate(postId, prompt)` as the canonical entrypoint. This spec keeps that public shape; the new internal module sits under `src/lib/ai/image-generator.ts` to mirror the existing `post-generator.ts` pattern.

---

## Architectural decisions (one-line each, with rationale)

1. **Image prompts come from the existing caption call (Option A — one call).** The Anthropic call in `postGenerator.generate` is extended to return both caption text AND `imagePrompt` for each post. No second AI pass for prompt-writing.
2. **Batch-wide consistency via a shared `batchImageStyle` field on the same tool output.** The model produces one style directive for the whole batch + N per-post `imagePrompt` subjects. Server combines them: `finalPrompt = batchImageStyle + " " + post.imagePrompt`. Reason: a single source of truth beats inlining the style into every per-post prompt (LLMs drift; one field doesn't).
3. **Image fan-out runs AFTER the text DB transaction commits, not inside it.** Long-lived transactions over remote API calls are an anti-pattern already flagged in `schedule-service.ts`. Backfill `post_images` rows in a second write per image as each lands.
4. **All images fire in parallel (Pattern A from investigation).** Bounded by `p-limit` at concurrency 3. The "fire as each text becomes available" property collapses to "fire all 7-9 simultaneously when `generate()` returns" because all captions arrive together in one Anthropic call. Functionally equivalent UX; minimum-risk path.
5. **Server-side `setImmediate`-style fire-and-forget for Wave 1.** The `generateWeekly` server action returns to the user as soon as the text transaction commits. Image generation runs after the response. UI polls (or revalidates) to discover image rows as they land. Reason: avoids Server Action timeout for slow image batches; matches the spec's "pending/generating → loading placeholder" display contract.
6. **Provider abstraction introduced now, not later.** A new `src/lib/ai/openai.ts` singleton (mirrors `anthropic.ts`) + a new `src/lib/ai/image-generator.ts` use-case module. Every OpenAI call in the codebase goes through it. Switching to Gemini Imagen later means swapping one module, not chasing call sites.
7. **`post_images.status` enum added now.** Without it, "no row" is ambiguous (failed? still generating? skipped?). Wave 1 sets `pending → generating → success | failed`; Wave 2 reuses the same column for retry tracking.
8. **No auto-retry in Wave 1.** A failed image stays `failed`. Retry is a manual user action — Wave 2.

---

## Schema changes

All schema changes go via **drizzle generate** then **drizzle migrate**. Never `drizzle push`.

### `post_images` (existing table at `src/lib/schema.ts:333-359`)

Add one column:

```ts
// In postImages pgTable definition
status: text("status").notNull().default("pending"),
// Union: "pending" | "generating" | "success" | "failed"
```

Rationale: `pending` is the row state immediately after `generateWeekly` commits and the image-job has been enqueued. `generating` is set when the OpenAI call starts (so the UI can distinguish "queued" from "in progress" if it ever needs to). `success` is set after the Blob URL is written. `failed` is set when the OpenAI call or Blob upload throws.

Existing columns reused as-is — no changes to:
- `imageUrl` (`schema.ts:346`): becomes non-null only when `status="success"`. For `pending`/`generating`/`failed` we insert a placeholder URL like `""` — see *Implementation note on NOT NULL* below.
- `imagePrompt` (`schema.ts:347`): stores the **combined** prompt (`batchImageStyle + " " + post.imagePrompt`) so the row carries the exact string sent to OpenAI. Wave 2 retries can re-use it.
- `attempt` (`schema.ts:348`): defaults to 1. Wave 1 only ever writes attempt=1. Wave 2 increments on manual retry.
- `source` (`schema.ts:351`): Wave 1 always writes `"ai"`.
- `selected` (`schema.ts:349`): Wave 1 always writes `true` (only one image per post; it's implicitly selected). Future waves with multiple candidates per post would use this.
- `publishedAt` (`schema.ts:352`): null in Wave 1. Wave 3 (post-publish blob delete) writes here.

**Implementation note on NOT NULL `imageUrl`.** Two options to handle the pre-success states:

- **Option 1 (recommended):** Make `imageUrl` nullable. Less surprising than a sentinel value. Single-line migration.
- **Option 2:** Insert with `imageUrl: ""` as a placeholder, swap to the real URL when `status` flips to `success`. Avoids a schema change to nullability.

This spec recommends **Option 1** — make `imageUrl` nullable. The semantic invariant becomes: `imageUrl IS NOT NULL` iff `status = 'success'`. Cleaner for the UI's `null`-check than a magic empty-string.

### `weekly_batches` (existing table)

Add one column to support Wave 2 retries without breaking the batch-wide consistency contract:

```ts
batchImageStyle: text("batch_image_style"),
// Nullable: pre-Wave-1 batches have no style; post-Wave-1 batches always do.
// Stored so Wave 2 retries can rebuild the same shared style for the new attempt.
```

**Why store it on `weekly_batches`, not `posts`?** The style is shared across the entire batch by definition. Putting it on `posts` would duplicate it 7-9 times.

### Migration ordering

Single migration file generated by `drizzle generate`. Two `ALTER TABLE` statements (one per table, one or two columns). No data backfill needed — existing rows pre-Wave-1 simply have NULL for both new fields, and the application code treats NULL as "no images attempted for this batch".

---

## Provider abstraction

Two new files. Both server-only (the consumer chain already guarantees server-only via `import "server-only"` in `post-service.ts`).

### `src/lib/ai/openai.ts` (new)

Mirror of `src/lib/ai/anthropic.ts:1-46`. Singleton instance + model constant.

```ts
import "server-only";
import OpenAI from "openai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const OPENAI_IMAGE_MODEL = "gpt-image-1.5";
// Model id confirmed valid in OpenAI's current catalog (R1 resolved).
// No fallback required.
```

Add `openai` to `package.json` (`npm install openai`). Confirm the installed major version exposes `openai.images.generate(...)` returning a base64 / URL payload.

### `src/lib/ai/image-generator.ts` (new)

Mirror of `src/lib/ai/post-generator.ts` in shape:

```ts
import "server-only";
import { openai, OPENAI_IMAGE_MODEL } from "@/lib/ai/openai";

/**
 * Generate one image for one post. Never throws — returns null on any
 * failure path (network, OpenAI 4xx/5xx, content-policy refusal).
 * Callers update `post_images.status` to "failed" on null.
 */
export async function generateImage(args: {
  combinedPrompt: string;       // batchImageStyle + " " + post.imagePrompt
  size?: "1024x1024" | "1536x1024" | "1024x1536";  // default 1024x1024
}): Promise<{ imageBuffer: Buffer; mimeType: string } | null> {
  try {
    const response = await openai.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: args.combinedPrompt,
      size: args.size ?? "1024x1024",
      n: 1,
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return null;
    return {
      imageBuffer: Buffer.from(b64, "base64"),
      mimeType: "image/png",  // GPT image models default to PNG
    };
  } catch (err) {
    console.error("[image-generator] generateImage threw", err);
    return null;
  }
}
```

**Stage 2 reconciliation notes** (folded back into this spec after verifying the installed `openai@6.42.0` types at `node_modules/openai/resources/images.d.ts`):
- **Size enum:** GPT image models (gpt-image-1.5 included) accept `1024x1024 | 1536x1024 | 1024x1536`. The DALL-E-3 sizes (`1792x1024 / 1024x1792`) the spec originally listed are NOT supported by `gpt-image-1.5` and would 400 the request.
- **No `response_format`:** the SDK's `ImageGenerateParams.response_format` is documented as `dall-e-2 / dall-e-3` only — *"This parameter isn't supported for the GPT image models, which always return base64-encoded images."* The shipped `image-generator.ts` omits it accordingly.

Public contract: never throws, returns `null` on failure. Matches the never-throws contract `post-generator.ts:13-14` documents and that `generateWeekly` already relies on.

---

## Caption-call schema extension (`post-generator.ts`)

This is the most delicate change. The captions are tuned and quality is good — adding fields must not regress them. The plan:

### What changes

1. **Tool schema (`post-generator.ts:385-454`)** — the per-call `postGenerationTool.input_schema`:
   - Inside `items.properties` (currently `postOrder | postText | hashtags | variations`), add:
     ```json
     "imagePrompt": {
       "type": "string",
       "minLength": 30,
       "maxLength": 380
     }
     ```
     (Cap is 380 — combined with `batchImageStyle.max(600)` + 1 space joiner = 981 chars, safely under OpenAI's ~1000-char image-prompt limit. Re-balanced from 580/400 in Stage 4 after live runs showed the model writes richer styles than 400 allows. See R7.)
   - Add `"imagePrompt"` to the `items.required` array (currently `["postOrder", "postText", "hashtags", "variations"]`).
   - Add a sibling top-level property next to `posts`:
     ```json
     "batchImageStyle": {
       "type": "string",
       "minLength": 30,
       "maxLength": 600
     }
     ```
   - Add `"batchImageStyle"` to the top-level `required` array (currently `["posts"]`).

2. **Module-level Zod (`post-generator.ts:297-311`)** — extend `postObjectSchema` with:
   ```ts
   imagePrompt: z.string().min(30).max(380),
   ```
   And extend `generatedShape`:
   ```ts
   const generatedShape = z.object({
     posts: z.array(postObjectSchema),
     batchImageStyle: z.string().min(30).max(600),
   });
   ```
   The `Generated` type at line 326 picks up both new fields automatically.

3. **Per-call Zod (`post-generator.ts:460-468`)** — the `generatedSchema` inside `generate()` derives from `postObjectSchema` via `.extend({ postOrder: ... })`, so it inherits the new `imagePrompt` field automatically. Verify that the `.length(postCount)` constraint and `batchImageStyle` shape both serialize correctly. The wrapper object now has both `posts` AND `batchImageStyle` — update accordingly:
   ```ts
   const generatedSchema = z.object({
     posts: z.array(
       postObjectSchema.extend({
         postOrder: z.number().int().min(1).max(postCount),
       })
     ).length(postCount),
     batchImageStyle: z.string().min(30).max(600),
   });
   ```

4. **System prompt (`buildSystemPrompt` at `post-generator.ts:143-220`)** — append a new section after `HASHTAG RULES:` (the last current section, line 213):

   ```
   IMAGE PROMPTS:
   For each post, also produce a short imagePrompt: a 1-2 sentence
   description of a single still image that would complement the caption.
   Focus on the SUBJECT (what's in the frame, what action, what setting).
   Do NOT include style, lighting, mood, or color choices in the
   per-post imagePrompt — those belong in the batchImageStyle.

   Also produce ONE batchImageStyle that applies to the whole set of
   N images. This describes the consistent visual treatment across all
   images: lighting (soft natural / dim warm / overcast), composition
   (close-up / wide / overhead), color palette, mood, and medium
   (photography / illustration / hand-drawn). Derive it from the brand's
   existing brand voice and tone so the images feel like the brand. The
   same batchImageStyle MUST apply to every image in the set — the goal
   is a cohesive set, like one photographer shot them all.

   Keep both fields safe-for-work and free of copyrighted likenesses,
   logos, or trademarks.
   ```

5. **Update the user message (`post-generator.ts:476-487`)** — extend the existing brief instruction:
   - Current: `"Generate exactly ${postCount} posts (postOrder 1 through ${postCount}). For each post include an Instagram variation and a LinkedIn variation per the rules in the system prompt."`
   - Add: `"Also produce one batchImageStyle (shared across all images) and an imagePrompt per post."`

6. **Token budget (`post-generator.ts:33`)** — `MAX_OUTPUT_TOKENS = 8000` is currently sized for "worst-case Pro batch (9 × ~700 tokens)". Adding `imagePrompt` (~50-150 tokens per post) + one `batchImageStyle` (~100 tokens) is ~700-1500 extra tokens. Recommendation: bump to `MAX_OUTPUT_TOKENS = 9500` to retain margin. The cached system prompt is unaffected (only the *output* grows).

### Caption-quality verification step

**This is a required acceptance gate.** After the changes:

1. Generate 5 batches at 7 posts each with the new schema.
2. Generate 5 batches at 9 posts each.
3. For each, compare canonical caption + IG + LinkedIn output against the same brand profile + theme run on the pre-change codebase (a side branch or pre-change snapshot).
4. Acceptance criterion: no visible regression in caption tone, length adherence, angle variety, or hashtag relevance. If captions degrade (e.g., model spends "budget" on imagePrompt and shortens captions), the system prompt may need re-tuning OR the imagePrompt fields may need to move to a separate second call (rolling back to a two-call architecture). Document the comparison findings before merging.

### Brand-tone threading

`brandTone` lives at `WebsiteAnalysis.brandTone: string` (`src/lib/schema.ts:118`) inside the JSONB `profiles.websiteAnalysis` (`schema.ts:135`). It is **nullable** at the profile level — users can skip the website step in onboarding. The existing system prompt at `post-generator.ts:167-181` already threads it under the conditional `analysisBlock`. No new threading required — the model already sees `brandTone`, `businessSummary`, `targetAudience`, etc. when present, and the new IMAGE PROMPTS section tells it to derive the `batchImageStyle` from "the brand's existing brand voice and tone".

**Fallback for profiles without `websiteAnalysis`:** the model falls back to `profile.tonePreference` (`casual | professional | mix`) and `profile.businessType`, both of which are unconditional in the system prompt at `post-generator.ts:158-162`. Image quality may be slightly less brand-tailored for these users but the call still works.

---

## `generateWeekly` orchestration changes

File: `src/lib/services/post-service.ts:821-970`.

### Where the image fan-out is inserted

After `db.transaction(...)` returns (line 958) and before the success return (line 960). The transaction itself stays unchanged — it commits the text batch, then we schedule the image work.

### Behaviour

1. **Inside the transaction (line 913-955)**: pre-insert N `post_images` rows with `status="pending"`, `attempt=1`, `source="ai"`, `imageUrl=null`, `imagePrompt = batchImageStyle + " " + post.imagePrompt`, `selected=true`. These are the rows the UI will see when it first loads — already-existing placeholders saying "an image is being prepared". The whole batch (`weekly_batches` + `posts` + `post_variations` + `post_images`) commits atomically.

2. **Persist `batchImageStyle` on the new column** — set `weekly_batches.batchImageStyle = generated.batchImageStyle` in the `tx.insert(weeklyBatches)` call (line 896-911).

3. **After commit**: fire image generation. Two viable patterns:

   - **3a. Fire-and-forget (recommended for Wave 1)**: spawn an async function with `void` (no `await`), let it complete after the action returns. The user's HTTP response unblocks immediately on text commit. The async job updates each row through `pending → generating → (success | failed)` as it runs.
     ```ts
     void runImageGenerationForBatch(batchId);   // returns immediately
     return { ok: true, batchId, ... };
     ```
     **Caveat on Vercel:** Vercel Serverless Functions kill background work when the response is sent. Fire-and-forget needs `waitUntil` from `@vercel/functions` (or `next/server`'s `after()` helper, App Router-native) to extend the function's life until the background work completes. Recommend `after()` since this is a Next.js Server Action context.

   - **3b. Await before return**: `await runImageGenerationForBatch(batchId)` before returning. Simpler but blocks the action for up to ~60s on a 9-post batch (3 concurrent × 3 waves × ~6s/call). Likely exceeds Vercel Hobby's 10s limit; risky even on Pro (60s default). Reject in favor of 3a.

   **Choice: 3a with `after()` from `next/server` — pending verification (see R3, critical path).**

   **Implementation step 1 (MUST run before any other code is written): verify `after()` from `next/server` is available and actually fires after the Server Action returns, in this project's Next + Turbopack setup.** Build a smallest-possible probe (a Server Action that calls `after(() => { /* write a marker row */ })`, then assert the marker row appears after the action returns). If `after()` does not fire, fall back to `waitUntil` from `@vercel/functions`. Document the chosen primitive both inline in `post-service.ts` AND back in this spec's **File-level change summary** section, before continuing to schema/migration work.

   **Rationale:** the after-primitive is a critical-path dependency for Wave 1. If neither `after()` nor `waitUntil` works in this environment, *no images ever generate* regardless of how correctly everything else is built. Discovering that after writing the schema, provider, generator, and orchestration code is the worst-case failure mode. Verify first.

### `runImageGenerationForBatch(batchId)` outline

This is a new function — recommended home: `src/lib/services/image-service.ts` (the file already exists; this is its first generation-side responsibility).

```ts
async function runImageGenerationForBatch(batchId: string): Promise<void> {
  const pLimit = (await import("p-limit")).default;
  const limit = pLimit(IMAGE_CONCURRENCY);  // 3

  // Read the N pending post_images rows + their combined imagePrompt
  const pending = await db.select({ ... })
    .from(postImages)
    .where(and(
      eq(postImages.batchId, batchId),  // (via posts join — postImages has no direct batchId)
      eq(postImages.status, "pending"),
    ));

  await Promise.allSettled(pending.map((row) => limit(async () => {
    await db.update(postImages)
      .set({ status: "generating" })
      .where(eq(postImages.id, row.id));

    const result = await generateImage({ combinedPrompt: row.imagePrompt });

    if (!result) {
      await db.update(postImages)
        .set({ status: "failed" })
        .where(eq(postImages.id, row.id));
      return;
    }

    // Upload to Blob via existing storage.ts
    const stored = await upload(
      result.imageBuffer,
      `${row.id}.png`,
      `post-images/${batchId}`,
    );

    await db.update(postImages)
      .set({ status: "success", imageUrl: stored.url })
      .where(eq(postImages.id, row.id));
  })));
}
```

**Note on the SELECT join:** `post_images` has `postId`, not `batchId` (`schema.ts:340`). The query needs an inner join to `posts` to filter by `batchId`. Trivial — calling out so the implementer doesn't get stuck.

**Concurrency cap**: `IMAGE_CONCURRENCY = 3` (new constant). Start at 3 to stay safely under typical OpenAI per-minute caps for image endpoints. Tune downward (to 2 or 1) if 429s appear in production logs; tune upward only after rate-limit headroom is verified.

### `p-limit` dependency

Not currently in the project. Add via `npm install p-limit`. Version pin: `^6.x` (current). No transitive dependencies of concern. Used only server-side.

### Partial-failure semantics

- One image's OpenAI call fails → that row goes `failed`, others continue. Batch is NOT marked failed.
- One image's Blob upload fails → same: row goes `failed`, others continue.
- Entire fan-out crashes (e.g., DB connection drop) → unhandled rows stay `pending` indefinitely. **Wave 1 acceptable** — Wave 2's retry control gives the user a manual way to recover. A future cron could sweep stale `pending` rows and re-trigger, but that's out of scope.
- The text batch is NEVER marked failed by an image failure. `weekly_batches.status` stays whatever the text path set it to (`"reviewing"`).

### Updated post-commit flow (annotated)

```
generateWeekly(input)
  ├─ profile check
  ├─ canGenerate gate
  ├─ resolveBatchPlan → totalPosts
  ├─ allocate batchId
  ├─ resolveLengthsForBatch(totalPosts, postLength, batchId)
  ├─ postGenerator.generate({ profile, theme, importantThing, lengths })
  │     └─ returns { posts: [...], batchImageStyle: "..." } | null
  ├─ if null → return { ok: false, error: "ai_failed" }
  ├─ db.transaction:
  │     ├─ INSERT weekly_batches (now includes batchImageStyle)
  │     ├─ INSERT posts (N rows)
  │     ├─ INSERT post_variations (0-2N rows)
  │     └─ INSERT post_images (N rows, status="pending", combined imagePrompt)  ← NEW
  ├─ after(): runImageGenerationForBatch(batchId)  ← NEW, non-blocking
  └─ return { ok: true, batchId, postsCreated, variationsCreated }
```

---

## Display (Wave 1, minimal)

Wherever a post tile currently shows its placeholder/empty image slot in the review UI:

| `post_images.status` | What renders |
|---|---|
| `success` (and `imageUrl` non-null) | The image itself, at the tile's existing image dimensions |
| `pending` | A loading placeholder — same dimensions, shimmer/skeleton, the existing UI skeleton component if there is one |
| `generating` | Same loading placeholder as `pending` (the UI doesn't need to distinguish them in Wave 1) |
| `failed` | A simple static "no image" placeholder — neutral surface, faint icon, no controls. Wave 2 will add a Retry button here. |

**Polling vs revalidation.** The action returns before images are ready. Two options:

- **Polling (recommended):** the review page polls a server function (`getBatchWithImages(batchId)`) every ~2-3 seconds until all rows are `success` OR `failed`. Stops polling on terminal state.
- **Push (deferred):** server-sent events or websockets. Out of scope for Wave 1.

Polling cadence: 2.5s. Tile transitions from skeleton → image without a page reload. After all rows are terminal, polling stops.

No retry control, no upload control, no delete control in Wave 1. Just the three display states.

---

## Env / secrets

`OPENAI_API_KEY` is already declared in `src/lib/env.ts:33` as `.optional()` with a production-required runtime check at `env.ts:149-156`. No env-schema change needed for Wave 1 — the existing optional declaration is correct (dev contributors without an OpenAI key can still work on non-image parts of the codebase; the image-generator surface fails gracefully via the never-throws contract).

**Server-side only — verified.** The key is read in exactly one place after this wave: `src/lib/ai/openai.ts` (which has `import "server-only"`). The transitive callers (`image-generator.ts` → `image-service.ts` → `post-service.ts`) are all server-only. No client-side surface touches the key.

`BLOB_READ_WRITE_TOKEN` is already declared in `env.ts:40` and used by `src/lib/storage.ts:152`. No change.

---

## Wave 1 acceptance criteria

A Wave 1 batch is correctly delivered if **all** of the following hold:

1. Database has a successful migration applied: `post_images.status` exists with default `"pending"`; `post_images.imageUrl` is nullable; `weekly_batches.batchImageStyle` exists.
2. `npm install openai p-limit` succeeds; `package.json` has both as `dependencies`.
3. `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
4. A test batch generated with a profile that has a complete `websiteAnalysis`:
   - Returns from `generateWeekly` in roughly the same time as before this wave (image fan-out is non-blocking).
   - All N `post_images` rows exist immediately after the action returns, `status="pending"`.
   - Within ~60s, every `post_images` row transitions to `success` or `failed` (no rows stuck in `pending` / `generating` indefinitely).
   - Successful images render on the review page; failed images render the "no image" placeholder.
   - Visual inspection: the 7 (or 9) images feel like a cohesive set — same style, different subjects.
5. A test batch generated with a profile that has `websiteAnalysis = null` (skipped onboarding):
   - Still produces images. They are less brand-tailored but not broken.
6. Caption-quality verification (see § *Caption-quality verification step* above): no visible regression vs pre-wave captions on 5 × 7-post and 5 × 9-post comparison runs.
7. Killing the OpenAI API key (set `OPENAI_API_KEY=invalid`) and generating a batch: text still completes, all 7-9 images land in `failed` state, no exception bubbles to the user, batch is reviewable.

---

## Risks & open questions

| # | Risk / question | Notes for the implementer |
|---|---|---|
| R1 | ~~Model id `gpt-image-1.5` may not match OpenAI's current catalog.~~ | **Resolved.** `gpt-image-1.5` confirmed valid in OpenAI's current catalog. No fallback needed. |
| R2 | **Caption quality may degrade when adding `imagePrompt` to the tool output.** | Mandatory comparison gate before merge (see § Caption-quality verification). If regression occurs, separate the calls (image-prompt becomes its own Claude call) — this is a Wave 1.5 fallback the schema already supports. |
| R3 | ~~`next/server`'s `after()` may not be enabled in this Next/Turbopack setup.~~ | **Resolved — Stage 0 verified.** Probe at `/probe-after/api` ran three times against Next 16.1.6 + Turbopack (dev mode); `markerAt − returnedAt` was +3ms / +4ms / +9ms across runs, confirming `after()` fires deferred after the response is sent. Chosen primitive: **`after()` from `next/server`**. No `@vercel/functions` / `waitUntil` fallback needed. Probe code + table dropped after verification. |
| R4 | **OpenAI rate limits at the project's tier.** | Unknown without checking the OpenAI dashboard. Concurrency cap of 3 is a conservative starting point. Watch logs in production; tune downward if 429s appear. |
| R5 | **`p-limit` is ESM-only in recent versions.** | The project is ESM (`"type": "module"` or Next.js's default transpilation handles it). Confirm `await import("p-limit")` works in the build context. |
| R6 | **Stale `pending` rows if the after-job crashes mid-flight.** | Wave 1 accepts this. Wave 2's retry button gives users a manual recovery path. A sweep cron is future work. |
| R7 | ~~Combined-prompt length may exceed OpenAI's prompt limit (~1000 chars for some image endpoints).~~ | **Resolved in spec (rebalanced Stage 4).** `batchImageStyle` ≤ **600** + `imagePrompt` ≤ **380** + 1 space joiner = **981** chars, safely under OpenAI's ~1000-char limit. Caps were rebalanced from the original 400/580 split after Stage 4 live runs showed the model writes richer styles than 400 allowed — Zod rejection on `batchImageStyle` was surfacing as a generic `ai_failed` to the user. The combined ceiling is unchanged (981); only the per-field allocation moved. Caps enforced in both the Anthropic tool schema and the Zod re-validation (see § Caption-call schema extension). |
| R8 | **Polling cost.** | At 2.5s cadence × ~60s of generation × 7-9 rows in the response, this is a non-trivial number of round-trips. Acceptable for Wave 1; if it becomes a problem, push (SSE) is the future answer. |

---

## File-level change summary (for the implementer)

| File | Change |
|---|---|
| `package.json` | Add `openai` and `p-limit` to `dependencies`. |
| `src/lib/env.ts` | No change (OPENAI_API_KEY already declared). |
| `src/lib/schema.ts` | Add `status` column to `postImages`. Make `imageUrl` nullable on `postImages`. Add `batchImageStyle` column to `weeklyBatches`. |
| `drizzle/...` (new migration) | Generated by `drizzle generate`. Apply via `drizzle migrate`. |
| `src/lib/ai/openai.ts` | **New.** Singleton OpenAI client + model constant. `import "server-only"`. |
| `src/lib/ai/image-generator.ts` | **New.** `generateImage({ combinedPrompt, size? })` never-throws → `{ imageBuffer, mimeType } \| null`. |
| `src/lib/ai/post-generator.ts` | Extend tool schema (add `imagePrompt` per-post + `batchImageStyle` top-level). Extend Zod schemas. Add IMAGE PROMPTS section to system prompt. Update user message. Bump `MAX_OUTPUT_TOKENS` to 9500. |
| `src/lib/services/post-service.ts` | Inside `generateWeekly` transaction: insert N `post_images` rows with `status="pending"`, combined imagePrompt, `attempt=1`, `source="ai"`, `selected=true`. Persist `batchImageStyle` on `weekly_batches`. After commit: call `runImageGenerationForBatch(batchId)` via **`after()` from `next/server`** (verified working in Stage 0 — see R3). |
| `src/lib/services/image-service.ts` | Add `runImageGenerationForBatch(batchId)`. Pulls pending rows, p-limit-3 fan-out, calls `generateImage`, uploads to Blob via `storage.upload`, updates row to `success` / `failed`. |
| Review-page UI (existing file — locate during implementation) | Add three display states (`success`, `pending`/`generating`, `failed`) on the per-post tile. Add 2.5s polling that stops when all rows are terminal. |

No changes to: `subscription-service.ts`, `schedule-service.ts`, `profile-service.ts`, gating logic, billing logic.
