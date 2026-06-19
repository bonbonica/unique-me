# Task 13: Inline-text reduction + lift to popups/tooltips

## Status

pending

## Wave

5

## Description

Audit the touched pages from this redesign for excessive inline explanatory text and reduce it. Where a sentence-or-two of explanation IS useful, convert to a tooltip (small `?` icon hover/focus) or a click-time popover. The goal is the "serene, generous, intentional" brand: each page reads as a single focal action with minimal visual noise. Empty states stay as designed (one sentence + one action).

## Dependencies

**Depends on:** task-10, task-11 (so the final UI is in place to audit)
**Blocks:** None

**Context from dependencies:** All preceding waves have shipped the structural redesign. This task is a polish pass on the user-visible text density of the affected pages.

## Files to Create

- (Optionally) `src/components/info-tooltip.tsx` — small reusable wrapper around shadcn `Tooltip` with a `?` icon trigger, if not already present. Skip if the project already has one.

## Files to Modify

A targeted pass on the new/changed pages:

- `src/app/(app)/(onboarded)/create/page.tsx` and its `_components/*.tsx` — verify only welcome greeting + page title + button + stats. If task-09's helper text crept in, trim it.
- `src/app/(app)/(onboarded)/schedule-posts/page.tsx` and `[batchId]/page.tsx` — audit copy density. The page title + empty state + the NetworkWizard internals (which we don't touch) are enough. Remove any extra helper paragraphs.
- `src/app/(app)/(onboarded)/posting-soon/page.tsx` and `[batchId]/page.tsx` — same audit. If there's intro copy explaining "These are your scheduled posts", remove it — the page title says enough.
- `src/app/(app)/(onboarded)/cancelled-posts/page.tsx` — re-check the description line. If "Cancelled batches and single posts. Restore any of them from here." (from task-03) still reads well, keep. If too long, trim or move into an info-tooltip on the page title.
- Any other surface in this redesign where a "this page does X because Y" paragraph appears — apply the same trim rule.

## Technical Details

### Implementation Steps

1. **Page-by-page audit.** Walk through the dev server views for the 4 main pages. For each text element, ask:
   - Is this a label/title/action? Keep.
   - Is this an empty state? Keep (one sentence + one action).
   - Is this an explanatory paragraph? Either delete it or move to a tooltip.
2. **Tooltip pattern.** Use shadcn `<Tooltip>` (assume present; if not, install per project process — confirm with user before adding a dep). Trigger: small `Info` icon (`size-3.5`, stroke 1.5) next to a heading or label. Hover/focus shows content. Example:

   ```tsx
   <h2 className="flex items-center gap-1.5">
     Cancelled batches
     <Tooltip>
       <TooltipTrigger asChild>
         <Info className="size-3.5 text-muted-foreground" aria-label="What is a cancelled batch?" />
       </TooltipTrigger>
       <TooltipContent className="max-w-xs">
         A full week's set of posts that you cancelled before any of them were published.
       </TooltipContent>
     </Tooltip>
   </h2>
   ```

3. **Popover pattern (for "necessary" cases where tooltip is too small).** Use shadcn `<Popover>` with a click trigger. Reserved for surfaces where the user needs a small explanation but cluttering the page with it is worse. Example: a "?" button next to the stats strip that opens "How we count these" details.
4. **Cross-page consistency.** Same Info-icon size and style across all surfaces. If we end up with 3+ tooltips, extract `<InfoTooltip content="...">` as a helper to keep markup uniform.
5. **Edit one page at a time** for clean diffs.
6. Run `pnpm lint`, `pnpm typecheck`, `pnpm build`.
7. Dev-server review pass:
   - Each of the 4 main pages reads as one focal idea with the action prominent.
   - No paragraphs of helper text outside of empty states.
   - Tooltips are discoverable but unobtrusive.

### What "too much text" looks like

- A `<p>` of 2+ sentences explaining what a page is for above the action.
- A repeated "tip" or "hint" sentence on every card.
- Inline footnotes like "(Note: this only applies to Pro users)".
- Helper copy under a button explaining what it does.

### What "fine" looks like

- A single muted lead sentence under a page title (one sentence, max ~15 words).
- A one-sentence empty state with an action.
- A `?` tooltip the user can opt into.

### Notes on what NOT to change

- Do not modify the NetworkWizard internals — out of scope for this redesign and this task.
- Do not modify Image Library or Settings pages — they're explicitly out of scope.
- Do not remove labels, accessible names, or ARIA attributes in pursuit of "less text". Visible label minimalism ≠ accessibility minimalism.
- Do not delete error messages, validation messages, or confirmation copy. Those are functional, not decorative.

## Acceptance Criteria

- [ ] Each of the 4 main redesign pages (/create, /schedule-posts, /posting-soon, /cancelled-posts) renders with no explanatory paragraphs outside of empty-state copy.
- [ ] Where a small explanation is needed, it's behind an `Info` icon (tooltip or popover) — not on the page surface.
- [ ] Empty states are unchanged (one sentence + one action).
- [ ] No accessibility regression: every interactive element still has an accessible name; tooltips have proper ARIA roles via the shadcn primitive.
- [ ] Brand voice intact: no exclamation points, no hyperbole.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` all pass.

## Notes

- This task is the smallest of the spec — it should typically be a handful of removed `<p>` tags + one or two new tooltips. If the audit reveals many surfaces with heavy copy that don't belong in this redesign's pages (e.g. onboarding flows), note them in the handoff but don't touch them here.
- If shadcn `<Tooltip>` and `<Popover>` are not installed in the project, propose installing per shadcn process (`npx shadcn@latest add tooltip popover`) but confirm with the user before doing so — adding dependencies is a separate decision from this redesign's stated scope.
