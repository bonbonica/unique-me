import "server-only";
import { openai, OPENAI_IMAGE_MODEL } from "@/lib/ai/openai";

/**
 * OpenAI image-generation module for the post-image pipeline (Wave 1).
 * Mirrors {@link generate} from `post-generator.ts` in contract:
 *
 *  - **Never throws.** Every failure path returns `null` — network error,
 *    OpenAI 4xx/5xx, content-policy refusal, missing `b64_json` in the
 *    response, malformed payload, anything. Callers (image-service's
 *    `runImageGenerationForBatch`) map `null` onto `post_images.status =
 *    "failed"`. Stack traces never reach the user.
 *  - **One image per call.** Wave 1 doesn't use OpenAI's `n` parameter to
 *    request alternatives; that's for a future spec.
 *  - **Provider-abstraction boundary.** All OpenAI image traffic goes
 *    through this module. Switching providers (e.g. Gemini Imagen per
 *    Vision PDF §4) means rewriting this file and `openai.ts`; no caller
 *    site needs to change.
 *
 * Notes on the OpenAI SDK shape (verified against @openai/sdk 6.42.0 types
 * at `node_modules/openai/resources/images.d.ts` during Stage 2):
 *  - GPT image models ALWAYS return base64; passing `response_format` is
 *    unsupported (would 400 the request). We read `data[0].b64_json`.
 *  - Sizes are `1024x1024`, `1536x1024`, `1024x1536` for GPT image models.
 *    NOT the DALL·E-3 portrait/landscape variants.
 *  - Default `output_format` is `png`; we don't override.
 */

/**
 * Supported image sizes for `gpt-image-1.5` (and other GPT image models).
 * Constrained to the trio actually accepted by the API. `1024x1024` is the
 * default; the wider/taller variants are useful for non-square post tiles.
 */
export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

/**
 * One successful image generation. `imageBuffer` is the raw bytes ready to
 * hand to `storage.upload`; `mimeType` is `image/png` (default output_format)
 * unless a future revision opts into webp/jpeg.
 */
export type GeneratedImage = {
  imageBuffer: Buffer;
  mimeType: string;
};

/**
 * Generate one image for one post. Combined prompt = `batchImageStyle + " " +
 * post.imagePrompt` (produced by the Anthropic caption call). Caller is
 * responsible for length-capping; this module trusts its input.
 */
export async function generateImage(args: {
  combinedPrompt: string;
  size?: ImageSize;
}): Promise<GeneratedImage | null> {
  const size = args.size ?? "1024x1024";
  const promptLen = args.combinedPrompt.length;
  console.warn("[image-generator] generateImage start", {
    model: OPENAI_IMAGE_MODEL,
    size,
    promptLen,
  });
  try {
    const response = await openai.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: args.combinedPrompt,
      size,
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      // Log the response shape (not the full payload) so we can tell whether
      // OpenAI returned no `data` array, an empty array, a non-b64_json
      // variant, or something else entirely.
      console.error(
        "[image-generator] generateImage: response missing data[0].b64_json",
        {
          model: OPENAI_IMAGE_MODEL,
          hasData: Array.isArray(response.data),
          dataLength: response.data?.length ?? 0,
          firstItemKeys: response.data?.[0]
            ? Object.keys(response.data[0])
            : null,
        }
      );
      return null;
    }

    console.warn("[image-generator] generateImage ok", {
      bufferBytes: Buffer.byteLength(b64, "base64"),
    });
    return {
      imageBuffer: Buffer.from(b64, "base64"),
      mimeType: "image/png",
    };
  } catch (err) {
    // OpenAI SDK errors carry structured fields on the error object itself
    // (`status`, `code`, `type`, `requestID`) plus a nested `error` payload
    // with `code` / `type` / `message` / `param` from the API response.
    // Surfacing them flat makes the log line greppable and skips the noisy
    // stack trace that masked the actual cause in earlier triage.
    const e = err as {
      name?: string;
      status?: number;
      code?: string;
      type?: string;
      message?: string;
      requestID?: string;
      error?: {
        code?: string;
        type?: string;
        message?: string;
        param?: string;
      };
    };
    console.error("[image-generator] generateImage threw", {
      model: OPENAI_IMAGE_MODEL,
      size,
      promptLen,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      status: e.status,
      code: e.code ?? e.error?.code,
      type: e.type ?? e.error?.type,
      param: e.error?.param,
      apiMessage: e.error?.message,
      requestID: e.requestID,
    });
    return null;
  }
}
