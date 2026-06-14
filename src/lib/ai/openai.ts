import "server-only";
import OpenAI from "openai";

/**
 * OpenAI client used for:
 *  - Phase 3 — AI image generation (see `image-generator.ts`).
 *
 * The client is exported as a module-level singleton so all callers share one
 * underlying HTTP keep-alive pool — mirrors {@link anthropic} in shape. The
 * SDK reads `OPENAI_API_KEY` from `process.env` by default; we pass it
 * explicitly for clarity. `import "server-only"` ensures this module can
 * never be transitively imported into a client-component graph.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Pinned model identifier for image generation. `gpt-image-1.5` is the
 * current default GPT image model and is present in the openai SDK's
 * `ImageModel` union (verified against the installed types at Wave 1
 * Stage 2). Keep this as the single source of truth so a future model bump
 * is a one-line change.
 *
 * Notes on `gpt-image-1.5` specifics (from the installed @openai/sdk types):
 *  - Always returns base64; the `response_format` parameter is NOT supported
 *    for GPT image models. Callers must read `data[0].b64_json` directly.
 *  - Supported sizes: `1024x1024`, `1536x1024`, `1024x1536` (NOT the
 *    DALL·E-3 portrait/landscape sizes).
 *  - Default `output_format` is `png`.
 */
export const OPENAI_IMAGE_MODEL = "gpt-image-1.5";
