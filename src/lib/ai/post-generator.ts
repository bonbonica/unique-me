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
 *  - {@link generate} — one call produces N canonical Facebook posts (N is
 *    either 7 for a normal weekly batch or 9 for the Pro monthly bonus
 *    batch — see Phase 4 spec) plus optional Instagram / LinkedIn variations
 *    per post.
 *  - {@link regenerateOne} — one call rewrites a single post given the user's
 *    feedback, plus its IG/LinkedIn variations.
 *
 * Notes on cost / latency:
 *  - `max_tokens: 8000` covers a worst-case Pro batch (9 × ~700 tokens of
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
 * Per-slot length directive paragraph. Keyed by the concrete `PostLength`
 * subset (Mix is resolved up-stream into a per-slot array of these three
 * values — see `resolveLengthsForBatch` in `@/lib/scheduling/batch-calendar`),
 * so `"mix"` is intentionally absent from the Record. If a caller ever
 * passes `"mix"` here it's a programming error; the type system enforces
 * the exclusion via the `Exclude<PostLength, "mix">` keying.
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
type ConcretePostLength = Exclude<PostLength, "mix">;

const LENGTH_DIRECTIVES: Record<ConcretePostLength, string> = {
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
 * Trailing paragraph applied after both the global LENGTH directive and the
 * per-slot LENGTH PLAN — keeps the platform-variation behaviour identical
 * regardless of which branch built the section.
 */
const LENGTH_TRAILER =
  "Apply this length target to the canonical Facebook caption. Instagram and\n" +
  "LinkedIn variations should still respect their own platform conventions\n" +
  "above, but tilt in the same direction (short → tighter variations; long →\n" +
  "more room to breathe).\n\n";

const LENGTH_TRAILER_PER_SLOT =
  "Apply each slot's length target to its canonical Facebook caption.\n" +
  "Instagram and LinkedIn variations should still respect their own platform\n" +
  "conventions above, but tilt in the same direction (short → tighter\n" +
  "variations; long → more room to breathe).\n\n";

/**
 * Render the LENGTH section. Uniform `lengths` produce a single global
 * directive; mixed `lengths` produce a per-slot LENGTH PLAN. The Set-size
 * check is the lowest-overhead way to detect uniformity (3-element ceiling
 * on the universe of values) without sorting / comparing the array.
 */
function buildLengthSection(lengths: ConcretePostLength[]): string {
  if (lengths.length === 0) return "";

  const unique = new Set(lengths);
  if (unique.size === 1) {
    // Backwards-compatible single-directive form. The first element is the
    // only element when the Set collapsed to one value.
    const only = lengths[0] as ConcretePostLength;
    return "LENGTH:\n" + LENGTH_DIRECTIVES[only] + "\n" + LENGTH_TRAILER;
  }

  // Per-slot plan. Lines are 1-indexed so they line up with the
  // `postOrder: 1..N` field the tool schema enforces.
  const planLines = lengths
    .map((slotLength, idx) => {
      const ordinal = idx + 1;
      return `- Post ${ordinal}: ${slotLength} — ${LENGTH_DIRECTIVES[slotLength]}`;
    })
    .join("\n");

  return (
    "LENGTH PLAN — apply per slot:\n" +
    planLines +
    "\n\n" +
    LENGTH_TRAILER_PER_SLOT
  );
}

/**
 * Build the system prompt for both `generate` and `regenerateOne`. The brand
 * context is identical in both cases; only the user message differs. Plain
 * string concatenation — no template engine.
 *
 * When `profile.websiteAnalysis` is null (user has no website, or scrape
 * failed during onboarding) we skip the entire brand-summary block so the
 * model doesn't see empty `{{}}` placeholders.
 *
 * `lengths` shapes the appended LENGTH section. When every slot shares the
 * same length (short / medium / long for the entire batch) we emit a single
 * global LENGTH directive — same shape as pre-Wave-2 batches. When lengths
 * vary (the Mix case, resolved up-stream into a per-slot array via
 * `resolveLengthsForBatch`) we emit a LENGTH PLAN block listing each slot's
 * target so the model writes to the assigned shape post-by-post. Either way
 * the rest of the prompt is unchanged so platform / tone / hashtag rules stay
 * stable across batches.
 */
function buildSystemPrompt(
  profile: Profile,
  lengths: ConcretePostLength[],
  postCount: number
): string {
  const base =
    "You are a social media content expert. You create engaging, authentic posts " +
    "that reflect the business owner's unique voice and personality. Each post " +
    "should feel like the business owner wrote it themselves, not like AI-generated " +
    "content.\n\n" +
    "You will receive a brand profile and a weekly brief. Use the brand profile to " +
    `match tone, style, and audience. Make each of the ${postCount} posts take a different ` +
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
    `You must call the \`save_weekly_posts\` tool exactly once with ${postCount} post objects.\n` +
    "Each post object has:\n" +
    `  - postOrder: 1..${postCount}\n` +
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
    `Across the ${postCount} canonical posts, take ${postCount} different angles on the weekly theme.\n` +
    "Examples: how-to, behind-the-scenes, customer story, contrarian take, practical tip,\n" +
    "question to the audience, personal reflection. Don't repeat the same structure twice.\n\n" +
    "VOICE GUARDRAILS:\n" +
    "- Match the brand profile's preferred tone (casual / professional / mix).\n" +
    "- If the brand voice from website analysis is available, weight it heavily.\n" +
    "- Avoid generic AI phrases: \"in today's fast-paced world\", \"leverage\", \"unlock the power of\", etc.\n" +
    "- Avoid corporate-speak unless the brand is explicitly corporate.\n" +
    "- Write the way a small-business owner with a strong personal voice would write.\n\n" +
    buildLengthSection(lengths) +
    "HASHTAG RULES:\n" +
    "- Canonical (Facebook): 3-8 hashtags.\n" +
    "- Instagram variation: 8-30 hashtags, mix of broad reach + niche.\n" +
    "- LinkedIn variation: 3-6 hashtags, professional and topical.\n" +
    "- Never invent generic hashtags like #SmallBusiness #Tips unless they fit naturally.\n";

  return base + analysisBlock + rules;
}

// =============================================================================
// Tool schema (regenerateOne — single-post)
// =============================================================================

// The generate tool schema is built inline inside `generate` because its
// `minItems` / `maxItems` / `postOrder.maximum` close over the runtime
// `postCount` (7 or 9). Keeping it inline avoids a builder indirection and
// keeps the JSON shape obvious at the call site.

/**
 * Tool schema for the single-post regenerate path. Same per-post shape as
 * the items inside the generate tool's `posts` array; the wrapper is gone.
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

// Per-post shape. `postOrder` is bounded by `postCount` at call time inside
// `generate` (the actual revalidation schema rebuilds the postOrder bound);
// the module-level version below keeps the loose `min(1)` so the exported
// `Generated` type stays stable across both 7- and 9-post batches.
const postObjectSchema = z.object({
  postOrder: z.number().int().min(1),
  postText: z.string().min(20).max(2200),
  hashtags: z.array(z.string().max(60)).max(15),
  variations: z.object({
    instagram: variationSchema.optional(),
    linkedin: variationSchema.optional(),
  }),
});

// Shape only — the `.length(args.postCount)` constraint is applied inside
// `generate`. Defined here so `Generated` is a single source of truth.
const generatedShape = z.object({
  posts: z.array(postObjectSchema),
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

export type Generated = z.infer<typeof generatedShape>;
export type RegeneratedOne = z.infer<typeof regeneratedOneSchema>;

// =============================================================================
// generate — produce N posts in one call (N = 7 for weekly, 9 for Pro monthly)
// =============================================================================

/**
 * Generate the weekly batch. One Anthropic call → N canonical Facebook
 * captions (N = 7 for a normal weekly batch, 9 for the Pro monthly bonus
 * batch — see Phase 4 spec), each with optional Instagram and LinkedIn
 * variations.
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
  // Per-slot length array. One entry per post in the batch; MUST NOT contain
  // `"mix"` — Mix is resolved up-stream by `resolveLengthsForBatch` into a
  // concrete `short | medium | long` per slot. `args.lengths.length` is the
  // batch's post count (the previous `postCount` parameter is gone — the
  // array IS the source of truth, including for tool-schema bounds).
  lengths: PostLength[];
}): Promise<Generated | null> {
  try {
    const postCount = args.lengths.length;
    if (postCount < 1 || postCount > 9) {
      console.warn(
        `[post-generator] generate: unexpected lengths.length=${postCount}; ` +
          `supported range is 1..9. Returning null.`
      );
      return null;
    }

    // Defensive: lengths should never contain "mix" — `resolveLengthsForBatch`
    // resolves Mix to per-slot concrete values. If the type system ever lets
    // one through (e.g. a forged-tab post-mortem), fall the slot back to
    // "medium" rather than throw.
    const concreteLengths: ConcretePostLength[] = args.lengths.map((l) =>
      l === "mix" ? "medium" : l
    );

    const systemText = buildSystemPrompt(
      args.profile,
      concreteLengths,
      postCount
    );

    // Built per-call because `minItems` / `maxItems` / `postOrder.maximum`
    // depend on the runtime `postCount`. JSON-schema values are plain JS
    // numbers, not interpolated strings.
    const postGenerationTool: Anthropic.Tool = {
      name: TOOL_NAME,
      description: `Persist the week's ${postCount} social media posts.`,
      input_schema: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            minItems: postCount,
            maxItems: postCount,
            items: {
              type: "object",
              properties: {
                postOrder: {
                  type: "integer",
                  minimum: 1,
                  maximum: postCount,
                },
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

    // Per-call Zod schema closes over the derived `postCount`. The exported
    // `Generated` type is derived from `generatedShape` at module scope
    // (loose, no length constraint); applying `.length()` here narrows the
    // runtime check without changing the static shape callers see.
    const generatedSchema = z.object({
      posts: z
        .array(
          postObjectSchema.extend({
            postOrder: z.number().int().min(1).max(postCount),
          })
        )
        .length(postCount),
    });

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: cachedSystemPrompt(systemText),
      tools: [postGenerationTool],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content:
            "THIS WEEK'S BRIEF:\n" +
            `- Theme: ${args.theme}\n` +
            `- The important thing to highlight: ${args.importantThing}\n\n` +
            `Generate exactly ${postCount} posts (postOrder 1 through ${postCount}). For each post ` +
            "include an Instagram variation and a LinkedIn variation per the " +
            "rules in the system prompt.",
        },
      ],
    });

    // Truncation is recoverable in principle (the schema's .length check
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
  // .regenerate) should pass the parent slot's resolved length so the rewrite
  // stays consistent with the surrounding posts. For Mix batches the caller
  // looks up the per-slot length via `resolveLengthsForBatch` and passes the
  // concrete value here — `regenerateOne` itself never sees `"mix"`, which is
  // enforced by the `Exclude<PostLength, "mix">` parameter type.
  postLength?: Exclude<PostLength, "mix">;
  // Size of the parent batch (7 for a normal weekly batch, 9 for the Pro
  // monthly bonus batch). Used so the user message ("post X of N") and the
  // system prompt reflect the correct total. Required — same rationale as
  // `generate`.
  postCount: 7 | 9;
}): Promise<RegeneratedOne | null> {
  try {
    const resolvedLength: ConcretePostLength = args.postLength ?? "medium";
    // The system prompt's LENGTH section is built from a uniform single-slot
    // array — same global-directive shape the original (pre-Wave-2)
    // `regenerateOne` produced. The `postCount` value drives the angle-variety
    // and "post X of N" framing only.
    const systemText = buildSystemPrompt(
      args.profile,
      [resolvedLength],
      args.postCount
    );

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
            `You are rewriting post ${args.postOrder} of ${args.postCount}. The user wasn't ` +
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
