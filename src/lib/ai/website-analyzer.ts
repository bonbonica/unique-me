import { z } from "zod";
import { anthropic, CLAUDE_MODEL, cachedSystemPrompt } from "@/lib/ai/anthropic";
import type { WebsiteAnalysis } from "@/lib/schema";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Hard upper bound on input text we send to Claude. Even with a generous
 * context window, business marketing pages rarely have meaningful signal
 * past the first ~30k chars — most of what follows is repeated boilerplate,
 * cookie disclosures, and footer links.
 */
const MAX_INPUT_CHARS = 30_000;

/**
 * Minimum input size below which analysis is not worth attempting. Sites that
 * scrape to <100 chars are almost always parked domains, "coming soon" pages,
 * or pure-image splash pages that Firecrawl could not extract from.
 */
const MIN_INPUT_CHARS = 100;

/**
 * Cap on tool output tokens. The analyzer returns a small structured object —
 * 1500 tokens is generous headroom over the maximum schema-allowed payload.
 */
const MAX_OUTPUT_TOKENS = 1500;

const SYSTEM_PROMPT = `You analyze small-business websites and extract a structured profile for AI-powered social-media post generation. You are concise, precise, and never hallucinate. If a field cannot be confidently determined from the input, return an empty array or a short generic string for it. Prefer short, concrete phrases over flowery marketing language.`;

const TOOL_NAME = "save_website_analysis";

/**
 * Tool schema sent to Claude. We use the tool-use pattern (rather than asking
 * for raw JSON) because Anthropic guarantees the model returns input matching
 * the `input_schema` — no string-to-JSON parsing failures and no need for the
 * model to escape anything inside its prose response.
 *
 * Field length limits here mirror the Zod schema below; the schema is the
 * actual enforcement boundary, the JSON Schema is just guidance for the model.
 */
const WEBSITE_ANALYSIS_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Persist a structured profile of the analyzed business website. Call this tool exactly once with the extracted fields.",
  input_schema: {
    type: "object",
    properties: {
      businessSummary: {
        type: "string",
        description:
          "1-2 sentence summary of what the business does, in plain language. Max 500 characters.",
        maxLength: 500,
      },
      servicesOffered: {
        type: "array",
        description:
          "Concrete services or products offered, as short noun phrases. Empty array if unclear.",
        items: { type: "string", maxLength: 120 },
        maxItems: 20,
      },
      targetAudience: {
        type: "string",
        description:
          "1-2 sentences describing who the business serves. Max 300 characters.",
        maxLength: 300,
      },
      brandTone: {
        type: "string",
        description:
          "Short descriptor of the brand's existing voice (e.g. 'warm and approachable', 'crisp and professional'). Max 120 characters.",
        maxLength: 120,
      },
      uniqueSellingPoints: {
        type: "array",
        description:
          "What makes this business different from competitors. Empty array if unclear.",
        items: { type: "string", maxLength: 200 },
        maxItems: 10,
      },
      suggestedTopics: {
        type: "array",
        description:
          "Topics this business could credibly post about on social media.",
        items: { type: "string", maxLength: 120 },
        maxItems: 15,
      },
    },
    required: [
      "businessSummary",
      "servicesOffered",
      "targetAudience",
      "brandTone",
      "uniqueSellingPoints",
      "suggestedTopics",
    ],
  },
};

/**
 * Zod schema mirroring the tool input. The model output is validated against
 * this before being returned to callers — defense-in-depth against the
 * (rare) case where Claude returns a malformed tool_use payload.
 */
const websiteAnalysisSchema = z.object({
  businessSummary: z.string().max(500),
  servicesOffered: z.array(z.string().max(120)).max(20),
  targetAudience: z.string().max(300),
  brandTone: z.string().max(120),
  uniqueSellingPoints: z.array(z.string().max(200)).max(10),
  suggestedTopics: z.array(z.string().max(120)).max(15),
});

/**
 * Analyze a block of website text and extract a structured business profile.
 *
 * Contract: never throws. Returns `null` when:
 *   - The input is too short to be meaningful (<100 chars).
 *   - The Anthropic API call fails for any reason.
 *   - The model returns no tool_use block.
 *   - The tool_use payload fails schema validation.
 *
 * Callers should treat a `null` return as "analysis unavailable" and persist
 * the profile without `websiteAnalysis`.
 */
export async function analyzeWebsiteContent(
  rawText: string
): Promise<WebsiteAnalysis | null> {
  const trimmed = rawText.trim();
  if (trimmed.length < MIN_INPUT_CHARS) {
    return null;
  }

  // Truncate to fit our cost / latency budget. We use a hard char cap rather
  // than a token estimate because the difference is small at this scale and
  // char-based truncation is deterministic across runs.
  const input =
    trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: cachedSystemPrompt(SYSTEM_PROMPT),
      tools: [WEBSITE_ANALYSIS_TOOL],
      // Force the model to use our tool — no free-form chatter, no choice.
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: `Analyze this website content:\n\n${input}`,
        },
      ],
    });

    // Find the tool_use block in the response. With tool_choice forcing this
    // specific tool there should be exactly one, but we defensively iterate.
    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: "tool_use" }> =>
        block.type === "tool_use" && block.name === TOOL_NAME
    );

    if (!toolUse) {
      console.error(
        "[website-analyzer] no tool_use block in response",
        response.stop_reason
      );
      return null;
    }

    const parsed = websiteAnalysisSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      console.error(
        "[website-analyzer] tool input failed schema validation",
        parsed.error.flatten()
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error("[website-analyzer]", err);
    return null;
  }
}
