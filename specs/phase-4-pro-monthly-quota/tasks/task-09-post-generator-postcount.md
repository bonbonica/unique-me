# Task 09: post-generator — Parameterise postCount

## Status
not started

## Wave
3

## Description

Add a `postCount: 7 | 9` parameter to `generate` and `regenerateOne` in `src/lib/ai/post-generator.ts`. Replace the hardcoded `7` in:

- The Zod result schema (`.length(7)` → `.length(args.postCount)`).
- The tool schema's `minItems` / `maxItems` (`7` → `args.postCount`).
- The prompt text mentioning "7 posts" → use the parameter.

Without this, batch 4 (9 posts) silently fails validation at generate time and the AI is also constrained to emit 7 items by the tool schema (D-A15a, D-A15c).

## Dependencies

**Depends on:** none (Wave 3 entry point)
**Blocks:** task-10 (`postService.generateWeekly` forwards `postCount`), task-11 (`regenerate` forwards `postCount`)
**Context from dependencies:** Wave 2 is service-layer math only; the generator is untouched there.

## Files to Modify

- `src/lib/ai/post-generator.ts` (modified)

## Implementation Steps

### 1. Update `generate` signature

```ts
export async function generate(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
  postLength?: PostLength;
  postCount: 7 | 9;
}): Promise<Generated | null>
```

`postCount` is REQUIRED (no default). The caller (postService) always knows the answer; relying on a default invites silent wrong-count batches.

### 2. Update `regenerateOne` signature

```ts
export async function regenerateOne(args: {
  profile: Profile;
  theme: string;
  importantThing: string;
  currentPostText: string;
  currentHashtags: string[];
  feedback: string;
  postOrder: number;
  postLength?: PostLength;
  postCount: 7 | 9;
}): Promise<RegeneratedOne | null>
```

Same — required, no default.

### 3. Replace literal 7 in three places

Find every occurrence of literal `7` related to post count in this file (currently at approximately lines 177, 311, and any prompt strings):

- **Zod schema** (~line 311 today):
  ```ts
  // Before:
  posts: z.array(postSchema).length(7),
  // After:
  posts: z.array(postSchema).length(args.postCount),
  ```
  Note: the Zod schema is defined inline inside the function (because `args.postCount` is a runtime value). If it's currently a module-level `const`, move it inside the function body — keeps the closure simple and explicit.

- **Tool schema** (~line 177 today):
  ```ts
  // Before:
  "maxItems: 7, minItems: 7"
  // After:
  `maxItems: ${args.postCount}, minItems: ${args.postCount}`
  ```
  If it's a JSON literal, template-interpolate cleanly; do not rely on string replacement at runtime.

- **Prompt text**: search for the string `"7 posts"` (or `"seven posts"`, or "Day 1 to Day 7") and replace with parameterised forms — "{args.postCount} posts", or "Day 1 to Day {args.postCount}". Audit the entire system prompt carefully — wrong day count in instructions risks confusing the model.

### 4. Audit other constants

After the three changes above, grep the file for `\b7\b` and confirm any remaining `7`s are unrelated to post count (e.g. retry counts, timeout seconds, etc.). Convert any genuinely post-count-related literal that was missed.

### 5. Type fidelity

Where `args.postCount` is used inside a string template, TypeScript narrows it to `7 | 9` — that's the desired type. Do not widen to `number` anywhere.

## Acceptance Criteria

- [ ] `generate` and `regenerateOne` both require `postCount: 7 | 9`.
- [ ] Zod schema's `.length(...)` is parameterised.
- [ ] Tool schema's `minItems` and `maxItems` are parameterised.
- [ ] Prompt text mentions the correct N (manual proofread).
- [ ] Calling `generate({ ..., postCount: 9 })` against the live Anthropic API returns 9 posts (manual smoke — does not need to land in this task's PR, but smoke before merging).
- [ ] No `\b7\b` literals remain in the file in a post-count semantic context.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The system prompt is critical here. The model has been trained to expect 7 daily posts; suddenly demanding 9 may produce subtly different copy. Smoke-test a 9-post generation before merging this task; if quality drops, tweak the prompt copy (e.g. "produce {N} consecutive daily posts" instead of "produce a 7-day batch") — but do this in a follow-up if needed, don't gate task 09 on prompt-engineering polish.
- Default values are deliberately omitted to force the caller to choose. The two callers (`postService.generateWeekly` in task 10 and `postService.regenerate` in task 11) both know the answer.
- Do NOT introduce a `postCount: number` (wide) type. The union `7 | 9` makes invalid values unrepresentable.
- The AI SDK / Anthropic tool schema is JSON, not TypeScript. Ensure the interpolation produces valid JSON (numbers, not strings).
