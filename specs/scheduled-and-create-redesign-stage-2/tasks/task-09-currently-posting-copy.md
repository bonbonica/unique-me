# Task 09: `in_progress` redirect copy — `See the batch currently posting →`

## Status
not started

## Wave
3

## Description

Per D-S2-17, swap the `/create` `in_progress` redirect copy from `Return to your current batch →` to `See the batch currently posting →`. Copy-only change — link target (`/posts`) and behaviour unchanged. The current Stage-1 copy lives in `<QuotaGatedScreen />`'s `quota` and `monthly_quota` variants (the two surfaces a non-trial user lands on while their batch is mid-posting). Both occurrences flip in this task.

Optionally extract a `<CurrentlyPostingCta />` wrapper at `src/components/create/currently-posting-cta.tsx` if both call sites can share one component — the spec lists the file as NEW in §4. Use judgement: if the only difference between the two existing call sites is the surrounding gate copy (yes), a shared one-line CTA component pays for itself. If the call sites diverge in any other way, leave them inline and just update the strings.

## Dependencies

**Depends on:** none.
**Blocks:** none.
**Parallel with:** task-07, task-08, task-10 (different files).

## Files to Create

- `src/components/create/currently-posting-cta.tsx` (new, optional) — single-line champagne CTA button wrapping `<Link href="/posts">` with the new copy. Only create this if you're collapsing both `<QuotaGatedScreen />` call sites onto it; otherwise skip.

## Files to Modify

- `src/components/create/quota-gated-screen.tsx` — both `<Link href="/posts">Return to your current batch →</Link>` occurrences (lines ~134 and ~185 at time of writing — re-locate via grep). Update copy to `See the batch currently posting →`, or replace with `<CurrentlyPostingCta />` if extracted.

## Implementation Steps

### 1. Locate the call sites

Two existing lines in `src/components/create/quota-gated-screen.tsx`:

```tsx
// QuotaVariant (~line 134) — Starter weekly cap
<Button asChild size="lg" className="rounded-full glow-champagne">
  <Link href="/posts">Return to your current batch →</Link>
</Button>

// MonthlyQuotaVariant (~line 185) — Pro 4/4 monthly cap
<Button asChild size="lg" className="rounded-full glow-champagne">
  <Link href="/posts">Return to your current batch →</Link>
</Button>
```

Both render only when the user is gated AND has an existing in-flight batch they can be sent back to — i.e. the `in_progress` redirect surface the spec calls out.

### 2. Option A — inline copy swap (simplest)

Replace both literal strings (no other change):

```tsx
<Link href="/posts">See the batch currently posting →</Link>
```

Two-character search-and-replace; `pnpm lint && pnpm typecheck` will catch any typo. Done.

### 3. Option B — extract `<CurrentlyPostingCta />` (per spec §4)

If you'd rather honour the spec's "NEW" file marker, create `src/components/create/currently-posting-cta.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Champagne CTA shown on `/create` gated screens when the user has an
 * `in_progress` batch they should be steered back to. Per DESIGN.md §9
 * the primary CTA on a focal surface uses `rounded-full` + `glow-champagne`;
 * per D-S2-17 the label reads `See the batch currently posting →`.
 *
 * The trailing arrow is a literal `→` character to keep the component a
 * single text node — matches the pre-Stage-2 inline link form, swapping
 * only the words before the arrow.
 */
export function CurrentlyPostingCta() {
  return (
    <Button asChild size="lg" className="rounded-full glow-champagne">
      <Link href="/posts">See the batch currently posting →</Link>
    </Button>
  );
}
```

Then in `quota-gated-screen.tsx`, replace both `<Button asChild>...</Button>` blocks with:

```tsx
<CurrentlyPostingCta />
```

This shrinks the QuotaVariant + MonthlyQuotaVariant return statements by ~3 lines each and keeps the new copy single-sourced.

### 4. Voice / tokens

- Copy (exact): `See the batch currently posting →`
- `Button` variant: default (champagne pill per DESIGN.md §9), `size="lg"` (`h-12 px-8`), `rounded-full`, `glow-champagne`.
- Link target unchanged: `/posts`.
- Trailing arrow is the same literal `→` character that was there before — keep it inside the Link text (not a separate `<ArrowRight>` icon) to preserve byte-for-byte rendering of the surrounding chrome.

### 5. What does NOT change

- The headlines above each CTA (`"Your next batch unlocks in N days, on …"` / `"You've used all 4 batches this period."`).
- The body paragraphs.
- The `useHasMounted` hydration sentinel.
- The build-headline / build-reset-copy module helpers.
- Light-mode vs dark-mode treatment of either variant.

## Acceptance Criteria

- [ ] Both `Return to your current batch →` strings in `quota-gated-screen.tsx` are replaced (no occurrences remain in the codebase under `src/`).
- [ ] New copy reads exactly `See the batch currently posting →` (mind the spaces and arrow).
- [ ] Link target stays `/posts`.
- [ ] Button styling unchanged (`size="lg"`, `rounded-full glow-champagne`).
- [ ] Hydration sentinel + headline composition unchanged.
- [ ] If `<CurrentlyPostingCta />` is extracted, both gated variants render it and no inline duplicate remains.
- [ ] `grep -r "Return to your current batch" src/` returns zero matches.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.
- [ ] Visual check: rendering `<QuotaGatedScreen variant="quota" nextResetAt={…} />` and `<QuotaGatedScreen variant="monthly_quota" nextResetAt={…} batchesUsed={4} />` both show the new copy.

## Notes

- DESIGN.md §14 voice: `See` is a calm, observational verb — matches the brand tone better than `Return to`, which implied the user had left somewhere they belonged. The new copy frames the gated screen as a "your batch is working — go watch it" moment rather than a "you're back where you started" one.
- Spec doc strings in `specs/scheduled-and-create-redesign-stage-2/spec.md` itself contain the old copy as historical reference (e.g. line 19) — leave those alone. Only `src/` strings are in scope.
- Stage-2 doesn't produce `in_progress` from data anywhere — this is purely a Phase-7-dormant surface fix. The redirect path exists; only its label changes.

## Out of scope

- Behaviour change. No new redirect, no new gate, no new server logic. Copy only.
- `<TrialGatedScreen />`. The trial branch already routes to the existing-batch CTA via different copy and stays untouched here.
- The Stage-1 `<QuotaGatedScreen />` `overage` and `inactive` variants — they don't contain the `Return to your current batch` string. Leave them as-is.
- Updating spec documents (`specs/phase-4-pro-monthly-quota/spec.md`, etc.) that quote the old copy. Spec docs are historical; only live `src/` strings flip.
