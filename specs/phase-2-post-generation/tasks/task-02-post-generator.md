# Task 02: Post Generator (AI Module)

## Status
not started

## Wave
2

## Description

Create `src/lib/ai/post-generator.ts` — the Anthropic-call module that produces 7 canonical Facebook posts (each with optional Instagram and LinkedIn text variations) in a single forced-tool-use call. Mirrors the never-throws + Zod-revalidate pattern from `src/lib/ai/website-analyzer.ts`. Also exports a `regenerateOne` variant for single-post regeneration (used by task-04).

## Dependencies

**Depends on:** task-01 (uses `Profile`, `PostVariation` types)
**Blocks:** task-03, task-04
**Context from dependencies:** Schema has `posts.feedback`, `posts.regeneration_count`, `post_variations` table, and the `VariationPlatform` / `SelectionPlatform` unions.

## Files to Create

- `src/lib/ai/post-generator.ts` — NEW

## Implementation Steps

### 1. File header + imports

```ts
import { z } from "zod";
import { anthropic, CLAUDE_MODEL, cachedSystemPrompt } from "@/lib/ai/anthropic";
import type { Profile } from "@/lib/schema";
import type Anthropic from "@anthropic-ai/sdk";
```

### 2. Constants

```ts
const MAX_OUTPUT_TOKENS = 8000;
const TOOL_NAME = "save_weekly_posts";
```

### 3. System prompt (verbatim from spec § 7)

Define `SYSTEM_PROMPT` as a template-string constant. The text MUST match the spec verbatim:

```
You are a social media content expert. You create engaging, authentic posts
that reflect the business owner's unique voice and personality. Each post
should feel like the business owner wrote it themselves, not like AI-generated
content.

You will receive a brand profile and a weekly brief. Use the brand profile to
match tone, style, and audience. Make each of the 7 posts take a different
angle on the weekly theme. Include relevant hashtags. Keep posts concise and
engaging — suitable for Instagram, Facebook, or LinkedIn.

THE BRAND PROFILE:
- Business name: {{businessName}}
- Business type: {{businessType}}
- Business description: {{businessDescription}}
- Preferred tone: {{tonePreference}}
- Platforms the user posts to: {{platforms}}
{{#if websiteAnalysis}}
- Brand summary: {{websiteAnalysis.businessSummary}}
- Services offered: {{websiteAnalysis.servicesOffered}}
- Target audience: {{websiteAnalysis.targetAudience}}
- Existing brand voice: {{websiteAnalysis.brandTone}}
- Unique selling points: {{websiteAnalysis.uniqueSellingPoints}}
- Topics they could credibly post about: {{websiteAnalysis.suggestedTopics}}
{{/if}}

OUTPUT STRUCTURE:
You must call the `save_weekly_posts` tool exactly once with 7 post objects.
Each post object has:
  - postOrder: 1..7
  - postText: the canonical caption, written for Facebook
  - hashtags: array of relevant tags (no leading #)
  - variations: { instagram?, linkedin? }

VARIATION RULES:
For every post, also produce:
  - An Instagram variation: same idea as the canonical, but adapted for Instagram.
    Shorter is fine. More hashtags (up to 30). Image-led tone. End with an IG-appropriate CTA.
  - A LinkedIn variation: same idea but adapted for LinkedIn.
    Longer-form welcome (up to 3000 chars). Professional framing. Fewer hashtags (3-6).
    Lead with insight, not promotion.

The variations are NOT translations or trivial rewrites — they should feel native
to the platform while preserving the canonical post's core idea and the brand voice.

ANGLE VARIETY:
Across the 7 canonical posts, take 7 different angles on the weekly theme.
Examples: how-to, behind-the-scenes, customer story, contrarian take, practical tip,
question to the audience, personal reflection. Don't repeat the same structure twice.

VOICE GUARDRAILS:
- Match the brand profile's preferred tone (casual / professional / mix).
- If the brand voice from website analysis is available, weight it heavily.
- Avoid generic AI phrases: "in today's fast-paced world", "leverage", "unlock the power of", etc.
- Avoid corporate-speak unless the brand is explicitly corporate.
- Write the way a small-business owner with a strong personal voice would write.

HASHTAG RULES:
- Canonical (Facebook): 3-8 hashtags.
- Instagram variation: 8-30 hashtags, mix of broad reach + niche.
- LinkedIn variation: 3-6 hashtags, professional and topical.
- Never invent generic hashtags like #SmallBusiness #Tips unless they fit naturally.
```

Implement actual template interpolation via plain string substitution (no templating engine needed). Build the system prompt inside the `generate` function from `args.profile`. Skip the `{{#if websiteAnalysis}}` block when `profile.websiteAnalysis` is null.

### 4. Tool schema

```ts
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
          required: ["postOrder", "postText", "hashtags", "variations"],
        },
      },
    },
    required: ["posts"],
  },
};
```

### 5. Zod schema for revalidation

```ts
const variationSchema = z.object({
  postText: z.string().min(20).max(3000),
  hashtags: z.array(z.string().max(60)).max(30),
});

const generatedSchema = z.object({
  posts: z.array(z.object({
    postOrder: z.number().int().min(1).max(7),
    postText: z.string().min(20).max(2200),
    hashtags: z.array(z.string().max(60)).max(15),
    variations: z.object({
      instagram: variationSchema.optional(),
      linkedin: variationSchema.optional(),
    }),
  })).length(7),
});

export type Generated = z.infer<typeof generatedSchema>;
```

### 6. `generate` function

```ts
export async function generate(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
}): Promise<Generated | null> {
  try {
    const systemText = buildSystemPrompt(args.profile);

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
            `THIS WEEK'S BRIEF:\n` +
            `- Theme: ${args.theme}\n` +
            `- The important thing to highlight: ${args.importantThing}\n\n` +
            `Generate exactly 7 posts (postOrder 1 through 7). For each post include an ` +
            `Instagram variation and a LinkedIn variation per the rules in the system prompt.`,
        },
      ],
    });

    if (response.stop_reason === "max_tokens") {
      console.warn("[post-generator] hit max_tokens — output may be truncated");
    }

    const toolUse = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> =>
        b.type === "tool_use" && b.name === TOOL_NAME
    );
    if (!toolUse) {
      console.error("[post-generator] no tool_use block", response.stop_reason);
      return null;
    }

    const parsed = generatedSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      console.error("[post-generator] schema validation failed", parsed.error.flatten());
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error("[post-generator]", err);
    return null;
  }
}
```

### 7. `buildSystemPrompt(profile)` helper

Private helper inside the file. Builds the prompt string from the constant template + profile fields. Substitutes `{{businessName}}`, etc. Skips the `{{#if websiteAnalysis}}` block when `profile.websiteAnalysis` is null. Uses plain `String.prototype.replace` — no template library.

### 8. `regenerateOne` function

Same shape as `generate` but for a single post. Different tool, different schema (one post output). Takes existing post text + user feedback as additional context in the user message. Used by `postService.regenerate` in task-04.

```ts
export async function regenerateOne(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
  currentPostText: string;
  currentHashtags: string[];
  feedback: string;
  postOrder: number;
}): Promise<{
  postText: string;
  hashtags: string[];
  variations: { instagram?: { postText: string; hashtags: string[] }; linkedin?: { postText: string; hashtags: string[] } };
} | null>;
```

Define a sibling tool `regenerate_one_post` with the same item-level shape (no `posts` array wrapper). Reuse `variationSchema`. Same never-throws contract. The user message includes the current post + feedback and asks Claude to rewrite *just this one* keeping angle variety in mind.

## Acceptance Criteria

- [ ] `src/lib/ai/post-generator.ts` exists
- [ ] `generate(...)` exported and never throws
- [ ] `regenerateOne(...)` exported and never throws
- [ ] Returns `null` on: network error, missing tool_use, schema validation failure, count mismatch
- [ ] System prompt skips the website-analysis block when `profile.websiteAnalysis` is null
- [ ] Uses `cachedSystemPrompt()` for the system text (prompt-cache discount)
- [ ] `tool_choice` forces the model into the named tool
- [ ] `max_tokens` set to 8000
- [ ] `npm run lint`, `npm run typecheck` clean

## Notes

- Do NOT log full Claude responses (could contain PII from the user's profile). Log `stop_reason` and `parsed.error.flatten()` only.
- If `stop_reason === "max_tokens"` fires in practice, bump to 12000 — see § 12 in the main spec.
- `claude-sonnet-4-6` is the model — already exported as `CLAUDE_MODEL` from `anthropic.ts`. Don't hardcode anywhere else.
