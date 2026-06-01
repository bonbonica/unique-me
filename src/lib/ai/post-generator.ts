import { z } from "zod";
import { anthropic, CLAUDE_MODEL, cachedSystemPrompt } from "@/lib/ai/anthropic";
import type { PostLength, Profile } from "@/lib/schema";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic-call module for weekly batch generation (Phase 2). Mirrors
 * {@link analyzeWebsiteContent} from `website-analyzer.ts` in shape and
 * contract:
 *  - Forced tool-use via `tool_choice` — the model never speaks free-form prose.
 *  - Zod-revalidation of the tool's input as defence-in-depth against the (rare)
 *    case Anthropic returns a payload that doesn't match the declared schema.
 *  - Never-throws contract — every failure path returns `null`. Callers
 *    decide how to degrade.
 *
 * Two exported entry points:
 *  - {@link generate} — one call produces 7 canonical Facebook posts plus
 *    optional Instagram / LinkedIn variations per post.
 *  - {@link regenerateOne} — one call rewrites a single post given the user's
 *    feedback, plus its IG/LinkedIn variations.
 *
 * Notes on cost / latency:
 *  - `max_tokens: 8000` covers a worst-case Pro batch (7 × ~700 tokens of
 *    canonical + IG + LinkedIn variants + hashtags). Below 4000 risks
 *    truncation; above 12000 is wasteful for our prompt-cache TTL window.
 *  - `cachedSystemPrompt` wraps the system text so repeated calls (e.g. a
 *    user regenerating multiple posts in a session) hit Anthropic's
 *    ephemeral cache, saving ~90% on those tokens.
 */

const MAX_OUTPUT_TOKENS = 8000;
const TOOL_NAME = "save_weekly_posts";
const REGEN_TOOL_NAME = "regenerate_one_post";

// =============================================================================
// System prompt
// =============================================================================

/**
 * Per-`PostLength` directive paragraph. Selected at prompt-build time based on
 * the value the caller resolved (NULL / undefined → "medium" — see callers).
 *
 * The word counts are advisory only; the wizard tolerates arbitrary-length
 * captions (Phase 2 R12 word wrap) and the Zod validator below still caps the
 * absolute maximums. We're shaping the *target* shape of generation, not
 * enforcing it post-hoc.
 *
 * Lives as a standalone LENGTH section appended after VOICE GUARDRAILS so it
 * sits with composition guidance — close enough to influence sentence rhythm,
 * far enough from HASHTAG / VARIATION rules that it doesn't get crossed with
 * platform-specific instructions.
 */
const LENGTH_DIRECTIVES: Record<PostLength, string> = {
  short:
    "Keep each caption to 1–2 sentences. Built to scroll-stop on mobile. " +
    "Aim for ~25 words max — every word earns its place.",
  medium:
    "2–4 sentences. Conversational — a hook, one supporting line, and a CTA. " +
    "Aim for ~40–70 words. This is the default cadence.",
  long:
    "5–8 sentences. Storytelling format — open with a hook, build context, " +
    "and land on a CTA. Aim for ~100–160 words. Use this length to earn " +
    "emotional weight, not to pad.",
};

/**
 * Build the system prompt for both `generate` and `regenerateOne`. The brand
 * context is identical in both cases; only the user message differs. Plain
 * string concatenation — no template engine.
 *
 * When `profile.websiteAnalysis` is null (user has no website, or scrape
 * failed during onboarding) we skip the entire brand-summary block so the
 * model doesn't see empty `{{}}` placeholders.
 *
 * `postLength` shapes a single appended LENGTH directive paragraph; the rest
 * of the prompt is unchanged regardless of length so platform / tone / hashtag
 * rules stay stable across batches.
 */
function buildSystemPrompt(profile: Profile, postLength: PostLength): string {
  const base =
    "You are a social media content expert. You create engaging, authentic posts " +
    "that reflect the business owner's unique voice and personality. Each post " +
    "should feel like the business owner wrote it themselves, not like AI-generated " +
    "content.\n\n" +
    "You will receive a brand profile and a weekly brief. Use the brand profile to " +
    "match tone, style, and audience. Make each of the 7 posts take a different " +
    "angle on the weekly theme. Include relevant hashtags. Keep posts concise and " +
    "engaging — suitable for Instagram, Facebook, or LinkedIn.\n\n" +
    "THE BRAND PROFILE:\n" +
    `- Business name: ${profile.businessName}\n` +
    `- Business type: ${profile.businessType}\n` +
    `- Business description: ${profile.businessDescription}\n` +
    `- Preferred tone: ${profile.tonePreference}\n` +
    `- Platforms the user posts to: ${profile.platforms.join(", ")}\n`;

  // Per-spec § 7: the website-analysis block is conditional on availability.
  // Some users skip the website step during onboarding; in that case the
  // model gets the four non-analysis fields above and that's it.
  const analysisBlock = profile.websiteAnalysis
    ? "- Brand summary: " +
      profile.websiteAnalysis.businessSummary +
      "\n- Services offered: " +
      profile.websiteAnalysis.servicesOffered.join(", ") +
      "\n- Target audience: " +
      profile.websiteAnalysis.targetAudience +
      "\n- Existing brand voice: " +
      profile.websiteAnalysis.brandTone +
      "\n- Unique selling points: " +
      profile.websiteAnalysis.uniqueSellingPoints.join(", ") +
      "\n- Topics they could credibly post about: " +
      profile.websiteAnalysis.suggestedTopics.join(", ") +
      "\n"
    : "";

  const rules =
    "\nOUTPUT STRUCTURE:\n" +
    "You must call the `save_weekly_posts` tool exactly once with 7 post objects.\n" +
    "Each post object has:\n" +
    "  - postOrder: 1..7\n" +
    "  - postText: the canonical caption, written for Facebook\n" +
    "  - hashtags: array of relevant tags (no leading #)\n" +
    "  - variations: { instagram?, linkedin? }\n\n" +
    "VARIATION RULES:\n" +
    "For every post, also produce:\n" +
    "  - An Instagram variation: same idea as the canonical, but adapted for Instagram.\n" +
    "    Shorter is fine. More hashtags are conventional (up to 30). Image-led tone.\n" +
    "    End with an IG-appropriate CTA.\n" +
    "  - A LinkedIn variation: same idea but adapted for LinkedIn.\n" +
    "    Longer-form welcome (~3000 chars as a rough upper bound — prefer concise\n" +
    "    but accept longer for storytelling formats). Professional framing.\n" +
    "    Fewer hashtags (3-6). Lead with insight, not promotion.\n\n" +
    "The variations are NOT translations or trivial rewrites — they should feel native\n" +
    "to the platform while preserving the canonical post's core idea and the brand voice.\n\n" +
    "ANGLE VARIETY:\n" +
    "Across the 7 canonical posts, take 7 different angles on the weekly theme.\n" +
    "Examples: how-to, behind-the-scenes, customer story, contrarian take, practical tip,\n" +
    "question to the audience, personal reflection. Don't repeat the same structure twice.\n\n" +
    "VOICE GUARDRAILS:\n" +
    "- Match the brand profile's preferred tone (casual / professional / mix).\n" +
    "- If the brand voice from website analysis is available, weight it heavily.\n" +
    "- Avoid generic AI phrases: \"in today's fast-paced world\", \"leverage\", \"unlock the power of\", etc.\n" +
    "- Avoid corporate-speak unless the brand is explicitly corporate.\n" +
    "- Write the way a small-business owner with a strong personal voice would write.\n\n" +
    "LENGTH:\n" +
    LENGTH_DIRECTIVES[postLength] +
    "\n" +
    "Apply this length target to the canonical Facebook caption. Instagram and\n" +
    "LinkedIn variations should still respect their own platform conventions\n" +
    "above, but tilt in the same direction (short → tighter variations; long →\n" +
    "more room to breathe).\n\n" +
    "HASHTAG RULES:\n" +
    "- Canonical (Facebook): 3-8 hashtags.\n" +
    "- Instagram variation: 8-30 hashtags, mix of broad reach + niche.\n" +
    "- LinkedIn variation: 3-6 hashtags, professional and topical.\n" +
    "- Never invent generic hashtags like #SmallBusiness #Tips unless they fit naturally.\n";

  return base + analysisBlock + rules;
}

// =============================================================================
// Tool schema (generate — 7-post array)
// =============================================================================

/**
 * JSON Schema for the generate tool's input. The model returns 7 post objects
 * inside a `posts` array. The Zod schema below mirrors this and is the actual
 * enforcement boundary.
 */
const POST_GENERATION_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Persist the week's 7 social media posts.",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        minItems: 7,
        maxItems: 7,
        items: {
          type: "object",
          properties: {
            postOrder: { type: "integer", minimum: 1, maximum: 7 },
            postText: { type: "string", minLength: 20, maxLength: 2200 },
            hashtags: {
              type: "array",
              items: { type: "string", maxLength: 60 },
              maxItems: 15,
            },
            variations: {
              type: "object",
              properties: {
                instagram: {
                  type: "object",
                  properties: {
                    postText: {
                      type: "string",
                      minLength: 20,
                      maxLength: 2200,
                    },
                    hashtags: {
                      type: "array",
                      items: { type: "string", maxLength: 60 },
                      maxItems: 30,
                    },
                  },
                  required: ["postText", "hashtags"],
                },
                linkedin: {
                  type: "object",
                  properties: {
                    postText: {
                      type: "string",
                      minLength: 20,
                      maxLength: 3000,
                    },
                    hashtags: {
                      type: "array",
                      items: { type: "string", maxLength: 60 },
                      maxItems: 10,
                    },
                  },
                  required: ["postText", "hashtags"],
                },
              },
              required: [],
            },
          },
          required: ["postOrder", "postText", "hashtags", "variations"],
        },
      },
    },
    required: ["posts"],
  },
};

/**
 * Tool schema for the single-post regenerate path. Same per-post shape as
 * the array items above; the wrapper is gone.
 */
const REGENERATE_ONE_TOOL: Anthropic.Tool = {
  name: REGEN_TOOL_NAME,
  description: "Save the rewritten version of a single post.",
  input_schema: {
    type: "object",
    properties: {
      postText: { type: "string", minLength: 20, maxLength: 2200 },
      hashtags: {
        type: "array",
        items: { type: "string", maxLength: 60 },
        maxItems: 15,
      },
      variations: {
        type: "object",
        properties: {
          instagram: {
            type: "object",
            properties: {
              postText: { type: "string", minLength: 20, maxLength: 2200 },
              hashtags: {
                type: "array",
                items: { type: "string", maxLength: 60 },
                maxItems: 30,
              },
            },
            required: ["postText", "hashtags"],
          },
          linkedin: {
            type: "object",
            properties: {
              postText: { type: "string", minLength: 20, maxLength: 3000 },
              hashtags: {
                type: "array",
                items: { type: "string", maxLength: 60 },
                maxItems: 10,
              },
            },
            required: ["postText", "hashtags"],
          },
        },
        required: [],
      },
    },
    required: ["postText", "hashtags", "variations"],
  },
};

// =============================================================================
// Zod revalidation
// =============================================================================

// Shared shape for a single variation. Re-used by both generate and
// regenerateOne — keeps the upper bounds in one place.
const variationSchema = z.object({
  postText: z.string().min(20).max(3000),
  hashtags: z.array(z.string().max(60)).max(30),
});

const generatedSchema = z.object({
  posts: z
    .array(
      z.object({
        postOrder: z.number().int().min(1).max(7),
        postText: z.string().min(20).max(2200),
        hashtags: z.array(z.string().max(60)).max(15),
        variations: z.object({
          instagram: variationSchema.optional(),
          linkedin: variationSchema.optional(),
        }),
      })
    )
    .length(7),
});

const regeneratedOneSchema = z.object({
  postText: z.string().min(20).max(2200),
  hashtags: z.array(z.string().max(60)).max(15),
  variations: z.object({
    instagram: variationSchema.optional(),
    linkedin: variationSchema.optional(),
  }),
});

// =============================================================================
// Public types
// =============================================================================

export type Generated = z.infer<typeof generatedSchema>;
export type RegeneratedOne = z.infer<typeof regeneratedOneSchema>;

// =============================================================================
// generate — produce 7 posts in one call
// =============================================================================

/**
 * Generate the weekly batch. One Anthropic call → 7 canonical Facebook
 * captions, each with optional Instagram and LinkedIn variations.
 *
 * Contract: never throws. Returns `null` on any failure:
 *  - Network error / Anthropic 5xx / timeout
 *  - Response missing the expected tool_use block
 *  - Tool input fails Zod re-validation (count mismatch, length bounds, etc.)
 *
 * Callers should treat `null` as "AI unavailable, retry" and surface a clean
 * inline error to the user — not a stack trace.
 */
export async function generate(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
  // Per spec D7: per-batch, Pro-only UI choice; Starter / Trial default to
  // "medium". The generator itself is plan-agnostic — callers resolve the
  // value. NULL / undefined ≡ "medium" for back-compat with Phase 2 batches
  // generated before this column existed.
  postLength?: PostLength;
}): Promise<Generated | null> {
  try {
    const resolvedLength: PostLength = args.postLength ?? "medium";
    const systemText = buildSystemPrompt(args.profile, resolvedLength);

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: cachedSystemPrompt(systemText),
      tools: [POST_GENERATION_TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content:
            "THIS WEEK'S BRIEF:\n" +
            `- Theme: ${args.theme}\n` +
            `- The important thing to highlight: ${args.importantThing}\n\n` +
            "Generate exactly 7 posts (postOrder 1 through 7). For each post " +
            "include an Instagram variation and a LinkedIn variation per the " +
            "rules in the system prompt.",
        },
      ],
    });

    // Truncation is recoverable in principle (the schema's .length(7) check
    // would reject a partial response), but it's worth surfacing so we can
    // decide whether to bump max_tokens.
    if (response.stop_reason === "max_tokens") {
      console.warn(
        "[post-generator] generate hit max_tokens — output may be truncated"
      );
    }

    const toolUse = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === TOOL_NAME
    );
    if (!toolUse) {
      console.error(
        "[post-generator] generate: no tool_use block",
        response.stop_reason
      );
      return null;
    }

    const parsed = generatedSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      console.error(
        "[post-generator] generate: schema validation failed",
        parsed.error.flatten()
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error("[post-generator] generate threw", err);
    return null;
  }
}

// =============================================================================
// regenerateOne — rewrite a single post given user feedback
// =============================================================================

/**
 * Rewrite a single post given the user's free-text feedback. Same brand
 * profile + theme context as `generate`; the user message also includes the
 * post's current text + hashtags so the model knows what's being replaced
 * and can preserve angle variety relative to its slot in the week.
 *
 * Same contract as {@link generate}: never throws, returns `null` on any
 * failure path. Callers should NOT bump the post's `regenerationCount` until
 * after this returns a non-null result (see `postService.regenerate`).
 */
export async function regenerateOne(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
  currentPostText: string;
  currentHashtags: string[];
  feedback: string;
  postOrder: number;
  // Same semantics as `generate`: undefined ≡ "medium". Callers (postService
  // .regenerate) should pass the parent batch's stored postLength so the
  // rewrite stays consistent with the surrounding 6 posts.
  postLength?: PostLength;
}): Promise<RegeneratedOne | null> {
  try {
    const resolvedLength: PostLength = args.postLength ?? "medium";
    const systemText = buildSystemPrompt(args.profile, resolvedLength);

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: cachedSystemPrompt(systemText),
      tools: [REGENERATE_ONE_TOOL],
      tool_choice: { type: "tool", name: REGEN_TOOL_NAME },
      messages: [
        {
          role: "user",
          content:
            "THIS WEEK'S BRIEF:\n" +
            `- Theme: ${args.theme}\n` +
            `- The important thing to highlight: ${args.importantThing}\n\n` +
            `You are rewriting post ${args.postOrder} of 7. The user wasn't ` +
            "happy with the first version. Rewrite it taking their feedback " +
            "into account. Keep the same overall slot in the week (don't " +
            "duplicate angles you might use for other posts); produce IG and " +
            "LinkedIn variations as usual.\n\n" +
            "CURRENT POST TEXT:\n" +
            args.currentPostText +
            "\n\nCURRENT HASHTAGS: " +
            (args.currentHashtags.length > 0
              ? args.currentHashtags.join(", ")
              : "(none)") +
            "\n\nUSER FEEDBACK:\n" +
            args.feedback +
            "\n\nCall the `regenerate_one_post` tool exactly once with the " +
            "rewritten post.",
        },
      ],
    });

    if (response.stop_reason === "max_tokens") {
      console.warn(
        "[post-generator] regenerateOne hit max_tokens — output may be truncated"
      );
    }

    const toolUse = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === REGEN_TOOL_NAME
    );
    if (!toolUse) {
      console.error(
        "[post-generator] regenerateOne: no tool_use block",
        response.stop_reason
      );
      return null;
    }

    const parsed = regeneratedOneSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      console.error(
        "[post-generator] regenerateOne: schema validation failed",
        parsed.error.flatten()
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error("[post-generator] regenerateOne threw", err);
    return null;
  }
}
