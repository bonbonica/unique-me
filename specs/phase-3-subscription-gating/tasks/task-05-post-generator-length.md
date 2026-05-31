# Task 05: postGenerator — Accept postLength + Fold Into Prompt

## Status
not started

## Wave
2

## Description

Modify `src/lib/ai/post-generator.ts` so the `generate` (and `regenerateOne` if it makes sense) function accepts a `postLength` parameter (`"short" | "medium" | "long"`). The value gets folded into the system prompt as a length directive. NULL / undefined treats as `"medium"` for backward compat.

## Dependencies

**Depends on:** none (works against existing module)
**Blocks:** task-06 (postService.generateWeekly passes the value through)
**Context from dependencies:** N/A.

## Files to Modify

- `src/lib/ai/post-generator.ts` (modified)

## Implementation Steps

1. Import `PostLength` from `@/lib/schema`.
2. Add an optional `postLength?: PostLength` field to the existing input object on `generate({ profile, theme, importantThing })`. Default to `"medium"` when undefined.
3. Add an optional `postLength?: PostLength` to `regenerateOne({ ... })` input as well. Same default.
4. Append a length directive paragraph to the system prompt. Suggested wording (tune at implementation time, not locked):

   ```
   LENGTH:
   - "short"  → "Keep each caption to 1–2 sentences. Built to scroll-stop on mobile. No more than ~25 words."
   - "medium" → "2–4 sentences. Conversational. Room for a hook + one supporting line + CTA. ~40–70 words."
   - "long"   → "5–8 sentences. Storytelling format. Open with a hook, build context, land on a CTA. ~100–160 words."
   ```

   Select the matching paragraph based on the resolved `postLength`. The directive should be a standalone section after the existing tone / format guidance so it doesn't fight with platform-specific instructions.

5. Don't change the tool / Zod schema for the output — the AI's response shape is unchanged. Only the prompt input changes.

6. If the existing prompt has hard char limits per platform that conflict with `"long"`, soften them to "as a rough upper bound" rather than absolute — long captions exceeding the prior cap should still be accepted by the Zod validator.

## Acceptance Criteria

- [ ] `generate` and `regenerateOne` accept `postLength` (optional; defaults to `"medium"`).
- [ ] The system prompt visibly contains different copy depending on which `postLength` is passed (eyeball with a console.log during manual QA, or unit-equivalent inspection).
- [ ] Calling without `postLength` produces the same output as calling with `"medium"` (back-compat).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- Don't add a `postLength` field to the AI's structured output schema. The AI returns captions; the LENGTH is a directive that shapes generation, not a value we want back.
- The exact word counts in the directive are advisory only — the AI doesn't strictly obey, and the wizard handles arbitrary-length captions (Phase 2 R12 word wrap). Tune the prompt for taste at implementation, not for compliance.
- "Pro user picks length" is a UI concern; the generator doesn't know the user's plan, only the length value passed in. Keep this clean.
