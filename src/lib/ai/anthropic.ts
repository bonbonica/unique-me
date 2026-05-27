import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic Claude client used for:
 *  - Phase 1 — website analysis during onboarding (see `website-analyzer.ts`).
 *  - Phase 2+ — weekly post generation.
 *
 * The client is exported as a module-level singleton so that all callers share
 * one underlying HTTP keep-alive pool. The SDK reads `ANTHROPIC_API_KEY` from
 * `process.env` by default; we pass it explicitly for clarity.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Pinned model identifier. Per AGENTS.md the project standardises on Claude
 * Sonnet 4.6. Keep this as a single source of truth so a future model bump is
 * a one-line change.
 */
export const CLAUDE_MODEL = "claude-sonnet-4-6";

/**
 * Wrap a system-prompt string in the Anthropic SDK's structured form with a
 * cache-control breakpoint on it. This enables Anthropic's prompt caching for
 * the system prompt — repeated calls with the same system text get a ~90 %
 * discount on those tokens (the cache TTL is ~5 min for ephemeral entries).
 *
 * Usage:
 *   anthropic.messages.create({
 *     model: CLAUDE_MODEL,
 *     system: cachedSystemPrompt("You are ..."),
 *     messages: [...],
 *   });
 *
 * See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
export function cachedSystemPrompt(text: string) {
  return [
    {
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}
