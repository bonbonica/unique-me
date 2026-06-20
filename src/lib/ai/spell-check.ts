import { anthropic, CLAUDE_MODEL, cachedSystemPrompt } from "./anthropic";

/**
 * Silent AI spell-check for batch inputs (theme + important-thing).
 *
 * Runs a single low-cost Sonnet call at batch generation time to fix
 * spelling mistakes in the user's typed input WITHOUT rephrasing,
 * expanding, contracting, or changing meaning. The corrected values
 * are persisted onto `weekly_batches` and feed into the downstream AI
 * post-generation prompt so the rest of the system never sees the
 * typos.
 *
 * **Best-effort contract:** any failure path — network error, model
 * error, malformed JSON, empty fields, anything unexpected — returns
 * the original inputs unchanged. Batch generation MUST NOT fail
 * because of spell-check; the user never sees an error from this
 * function.
 *
 * Token cost is tiny: short cached system prompt + two short user
 * fields + JSON-only response. Latency is added to the generation
 * critical path but is small compared to the main post-generation
 * call.
 */
export async function spellCheckBatchInputs(
  theme: string,
  importantThing: string,
): Promise<{ theme: string; importantThing: string }> {
  const fallback = { theme, importantThing };

  // Guard: empty input has nothing to correct. Skip the API call entirely.
  if (!theme.trim() && !importantThing.trim()) return fallback;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: cachedSystemPrompt(SYSTEM_PROMPT),
      messages: [
        {
          role: "user",
          content: JSON.stringify({ theme, importantThing }),
        },
      ],
    });

    const block = response.content.find((c) => c.type === "text");
    if (!block || block.type !== "text") return fallback;

    const parsed = parseSpellCheckResponse(block.text);
    if (!parsed) return fallback;

    // Defensive: ensure neither field came back empty (would suggest the
    // model misunderstood the task and dropped content). Fall back to
    // originals on any empty field.
    if (!parsed.theme.trim() || !parsed.importantThing.trim()) {
      return fallback;
    }

    return parsed;
  } catch (err) {
    console.error("[ai.spellCheckBatchInputs]", err);
    return fallback;
  }
}

/**
 * System prompt tightly scoped to spelling correction. Caching this
 * means repeated calls (every batch generation) get ~90% token
 * discount on the system tokens.
 */
const SYSTEM_PROMPT = `You are a strict spelling-correction service for short user-typed marketing inputs.

Input: a JSON object with two string fields, "theme" and "importantThing".

Task: return a JSON object with the same two fields, with ONLY spelling mistakes corrected.

Hard rules:
- Fix spelling mistakes. Nothing else.
- Do NOT rephrase, expand, shorten, summarize, translate, or change the meaning.
- Do NOT add or remove words unless removing a word is the only way to fix a clearly broken spelling.
- Preserve capitalization patterns, punctuation, line breaks, and emoji.
- Preserve product names, brand names, and proper nouns the user wrote (do not "correct" them unless they are clearly misspelled common words).
- If a word is ambiguous or might be intentional jargon/slang, leave it as-is.
- If the input has no spelling mistakes, return the original fields exactly.

Output format: a single JSON object on one line, with exactly the two keys "theme" and "importantThing", both strings. No prose, no markdown fence, no explanation.`;

/**
 * Parse the model's text response into the expected shape. Strict —
 * anything that doesn't conform returns null and the caller falls back
 * to the originals.
 */
function parseSpellCheckResponse(
  text: string,
): { theme: string; importantThing: string } | null {
  // Strip a possible markdown fence in case the model decides to wrap.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "theme" in parsed &&
      "importantThing" in parsed &&
      typeof (parsed as { theme: unknown }).theme === "string" &&
      typeof (parsed as { importantThing: unknown }).importantThing ===
        "string"
    ) {
      return {
        theme: (parsed as { theme: string }).theme,
        importantThing: (parsed as { importantThing: string }).importantThing,
      };
    }
    return null;
  } catch {
    return null;
  }
}
