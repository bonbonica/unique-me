# Task 12: /pricing Page — 3 Plan Cards, "Coming soon" CTAs

## Status
not started

## Wave
3

## Description

Update `/pricing` to show three cards (Free trial / Starter / Pro) using monthly prices only, sourced from `pricing.ts`. All Subscribe CTAs are inert ("Coming soon" disabled buttons) — real upgrade flow lands in Phase 5 with Polar.

## Dependencies

**Depends on:** task-02 (`PLAN_DETAILS`, `formatMonthlyPrice`)
**Blocks:** none
**Context from dependencies:** task-02 supplies all price + feature strings.

## Files to Modify

- `src/app/pricing/page.tsx` (modified) — replace existing content with 3-card grid
- Possibly `src/components/pricing/plan-card.tsx` (new) — extracted card component if the page gets unwieldy

## Implementation Steps

### 1. Grid layout

- Container: `container mx-auto px-5 sm:px-8 lg:px-12 py-20 sm:py-28`.
- Headline section: Fraunces `text-4xl sm:text-5xl tracking-tight`, subtitle Geist `text-lg text-muted-foreground`.
- Card grid: `grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8`. Stacks on mobile.

### 2. Plan card structure

Each card:

- Outer: `bg-card rounded-2xl p-8 shadow-soft border border-border`.
- Plan label: Fraunces `text-xl font-medium tracking-tight`.
- Price: Geist `text-4xl font-medium`, with `/mo` suffix in `text-base text-muted-foreground`. Use `formatMonthlyPrice(plan)` from `pricing.ts`.
  - Free trial: render "Free" + small line "7 days" instead of "$0/mo".
- Pitch line: Geist `text-sm text-muted-foreground leading-7`, 1–2 lines.
- Feature list: Geist `text-sm` bullets, `<Check />` icon prefix in `text-primary`.
- CTA: bottom of card.
  - Free trial: "Start free trial" if user is signed out (links to `/register`), or "Already on trial" disabled (if current plan = trial).
  - Starter / Pro: "Coming soon" disabled, `title="Payments arrive in Phase 5"`.

### 3. Pro card visual emphasis

Center card (Pro) gets a subtle champagne glow + "Recommended" small-caps badge above the headline. Implementation: `glow-champagne` class on the card border + a `<Badge variant="default" />` floated above.

### 4. Footer copy below grid

> *Plans are monthly. Annual options launch with payments.*

Small, centered, `text-xs text-muted-foreground`. Sets expectation that the absence of annual isn't an oversight.

### 5. Don't link to checkout / Polar / Stripe

There is no checkout. The CTAs are inert. Don't even render `<Link>` wrappers — use `<Button disabled />` with a `title` attribute for the tooltip explanation.

## Acceptance Criteria

- [ ] Three cards render in a row on `md+`, stacked on mobile.
- [ ] Prices match `pricing.ts` constants exactly (no literal strings in the page).
- [ ] All Starter/Pro CTAs are disabled with `title="Payments arrive in Phase 5"`.
- [ ] Free trial CTA correctly handles signed-out vs already-on-trial states.
- [ ] Pro card has the recommended emphasis (glow + badge).
- [ ] Footer line about annual plans renders.
- [ ] Page passes design-system check (Fraunces headline, generous padding, single champagne accent).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The current `/pricing` page (Phase 1/2 placeholder) likely shows outdated info or is empty. Wholesale-replace its body; preserve the route structure.
- If the page has SEO meta / OpenGraph tags from Phase 1, keep them — just update the visible content.
- Don't add a monthly/annual toggle. Phase 3 is monthly-only by lock.
