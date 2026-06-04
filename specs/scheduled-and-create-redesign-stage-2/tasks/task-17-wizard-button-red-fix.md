# Task 17: Wizard bulk Schedule button red fix (dark mode)

## Status
not started

## Wave
6

## Description

Deepen the dark-mode color of the `CheckSquare` icon inside the wizard's bulk Schedule button when `isAllSelected` is true (D-S2-19). Today the icon renders as `text-destructive` in both themes; in dark mode the warm coral lands at `oklch(0.72 0.12 35)`, which sits too close to the card background and reads as "muted" rather than "affirmed." Stage-2 deepens it to `oklch(0.62 0.18 30)` (a stronger rust/coral, still in the warm palette per DESIGN.md §3 — no pure crimson). Light mode is unchanged: the existing `text-destructive` token already clears AA on cream and the surface that fails is dark-mode only.

This is a one-line className edit in `src/components/posts/wizard-step.tsx`. No prop changes, no behavior change, no other surfaces touched.

## Dependencies

**Depends on:** none (independent UI fix).
**Blocks:** task-18 (the audit in task-18 must include this change in its grep / build checks; Wave 6 is fully sequential).
**Parallel with:** none — Wave 6 runs sequentially. Task-17 must complete before task-18 starts.

## Files to Modify

- `src/components/posts/wizard-step.tsx` — line ~160, the `CheckSquare` `className` on the bulk Schedule button.

## Implementation Steps

### 1. Locate the line

Today (post-Wave-1 of Stage-1), `src/components/posts/wizard-step.tsx:159–162` reads:

```tsx
<CheckSquare
  className={`size-4 ${isAllSelected ? "text-destructive" : ""}`}
  aria-hidden
/>
```

The icon sits inside the bulk Schedule button rendered at line 148. The `isAllSelected` branch is the "all posts selected — click to deselect" affirmation state. The surrounding chrome (the button itself, label, aria-label) does not change.

### 2. Preferred implementation — inline `cn()` with arbitrary Tailwind value

Replace the template-literal className with a `cn(...)` call so the conditional reads cleanly and we can scope the deeper color to dark mode only:

```tsx
<CheckSquare
  className={cn(
    "size-4",
    isAllSelected && "text-destructive dark:text-[oklch(0.62_0.18_30)]",
  )}
  aria-hidden
/>
```

Notes:
- `cn` is already imported elsewhere in the file via `@/lib/utils`. If it isn't already imported at the top of `wizard-step.tsx`, add `import { cn } from "@/lib/utils";` to the existing import block.
- Tailwind v4 arbitrary values require underscores in place of spaces inside `[...]`. Hence `oklch(0.62_0.18_30)` — Tailwind rewrites this to `oklch(0.62 0.18 30)` in the emitted CSS. **Do not write spaces inside the brackets** — Tailwind will reject the class.
- The `dark:` prefix scopes the override; under the `light` theme the icon keeps `text-destructive` (the rust hue defined in DESIGN.md §3 for light mode).

### 3. Fallback implementation — new utility class in `globals.css`

If the arbitrary-value Tailwind v4 syntax misbehaves in this project's `@theme inline` config (e.g. the v4 compiler emits the rule but it doesn't appear in the final stylesheet), add a dedicated utility class instead. Spec §6.14 names this fallback.

In `src/app/globals.css`, after the `@theme inline` block:

```css
@layer utilities {
  .text-destructive-strong {
    color: oklch(0.5 0.17 30);
  }
  .dark .text-destructive-strong {
    color: oklch(0.62 0.18 30);
  }
}
```

Then use:

```tsx
<CheckSquare
  className={cn(
    "size-4",
    isAllSelected && "text-destructive-strong",
  )}
  aria-hidden
/>
```

Pick the inline `cn` form first. Only fall back to the utility class if dev-mode HMR or the production build drops the arbitrary value from the emitted CSS. If you take the fallback, note it in the PR description so future surfaces that need the same red reuse the class rather than re-defining it.

### 4. Verify the rendered color

Run `pnpm dev`, open `/posts?batchId={id}` for a batch in `reviewing`, advance to the Facebook review step (or any wizard review step), click the "Schedule all" button so `isAllSelected` flips true. Inspect the icon in dark mode (theme toggle in the header).

Expected: the icon visually deepens from the prior pale coral to a clearly rust-leaning tone. The icon should be unmistakably visible against `bg-card` (`oklch(0.21 0.028 265)` in dark mode). Switch to light mode and confirm the color does NOT change — it remains the existing `text-destructive`.

## Acceptance Criteria

- [ ] `src/components/posts/wizard-step.tsx` line ~160 uses `cn(...)` (or the fallback utility class) — no more template-literal className for the `CheckSquare` icon.
- [ ] In dark mode, when `isAllSelected === true`, the icon color resolves to `oklch(0.62 0.18 30)` (verify via DevTools Computed Styles → `color`).
- [ ] In light mode, when `isAllSelected === true`, the icon color is unchanged from Stage-1 (still resolves to the `--destructive` token value).
- [ ] No other classes on the `CheckSquare`, the surrounding `<Button>`, or the bulk Schedule chrome are modified.
- [ ] `aria-label` on the button is untouched.
- [ ] If the fallback utility class route was taken, the new `.text-destructive-strong` rule is the only new CSS — no other utility classes added.
- [ ] `pnpm lint` and `pnpm typecheck` pass on the modified file.

## Notes

- DESIGN.md §3 explicitly keeps the destructive color inside the warm/gold family — `oklch(0.62 0.18 30)` is the deepest rust the system allows without crossing into pure crimson. Don't reach for a brighter red; the spec rejected that direction.
- The light-mode value (`oklch(0.5 0.17 30)` per DESIGN.md §3 light tokens) already clears AA on cream — that's why only dark mode needs the deepen.
- The aria-label already reads `"{N} {NETWORK_LABELS[platform]} posts scheduled — click to deselect all"` when `isAllSelected`. The color change is a visual reinforcement of the same affirmation; screen readers already get the message.
- This task is the lightest of Wave 6 — it exists separately so task-18's audit can include it in the `pnpm build:ci` + lint pass, and so task-19's E2E walkthrough has a checkbox for the dark-mode visual verification. Wave 6 stays sequential because the audit must include this change.

## Out of scope

- Repainting any other destructive icon, button, or chip across the app. Only this one wizard icon flips. DESIGN.md §15 ("Wider DESIGN.md repaint") is explicit.
- Adding a `text-destructive-strong` family of variants (foreground/background/border). If a future surface needs the same red as a fill or border, that's a separate spec.
- Refactoring the bulk Schedule button itself (size, padding, label structure). Only the icon `className` changes.
- Touching the `CheckSquare` icon in any other component (it appears in a handful of post-cards and selection toolbars — those keep `text-destructive` in the standard cases).
