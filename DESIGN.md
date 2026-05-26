# UniqueMe Design System

This document defines the visual design system for UniqueMe. All new components, pages, and marketing surfaces **must** follow these tokens, patterns, and conventions. When a decision isn't covered here, prefer the option that is more *serene, refined, confident, generous,* and *intentional* — those are the five adjectives the brand answers to.

---

## 1. Brand Foundation

**UniqueMe** is an AI social-media post generator and auto-poster for small-business owners — florists, bakers, salon owners, boutique retailers. Users sign up, tell us about their business, answer 2 weekly questions, and the app produces 7 image-and-copy posts that auto-publish to Facebook, Instagram, and LinkedIn.

The UI must make the business owner feel like they have hired a high-end service. Reference mood: an Aman Resort lobby at dusk — quiet, considered, expensive without being ostentatious. The user's content is the hero; the interface is the velvet tray it arrives on.

### Brand adjectives

| Adjective | What it means at the pixel level |
|---|---|
| **Serene** | Generous whitespace. One focal point per screen. Slow, gentle motion. |
| **Refined** | Serif headlines. 1.5px icon strokes. No exclamation points in microcopy. |
| **Confident** | Single primary CTA per surface. Big type. Restrained color use. |
| **Generous** | Padding is bigger than you think. Touch targets ≥ 44px. Empty states are designed, not skipped. |
| **Intentional** | Every gold accent is earned. Animations have a reason. No decorative chrome. |

### Anti-patterns — what UniqueMe is NOT

- Not a developer-tool aesthetic (Linear / Vercel / Stripe dark).
- Not crypto / web3 neon-on-black.
- Not playful or illustrated. Personality comes from typography, restraint, and a single gilt accent.
- Not bright. Avoid pure white surfaces, saturated chart colors, or rainbow gradients.
- Not light mode (in this phase). The champagne palette is designed for midnight; it loses identity on cream.

---

## 2. Stack

- **Framework:** Next.js (App Router) + React + TypeScript
- **Styling:** Tailwind CSS v4 (CSS-first config via `@theme inline` in `globals.css` — no `tailwind.config.ts`)
- **Components:** shadcn/ui (new-york style)
- **Icons:** Lucide React (default stroke width: `1.5`)
- **Fonts:** Geist (sans, UI/body) + Geist Mono (mono, code) + **Fraunces** (display serif, headlines) via `next/font/google`
- **Theme:** Dark only. The `next-themes` provider is configured with `forcedTheme="dark"`; no toggle is exposed in the UI.
- **Utilities:** `cn()` from `@/lib/utils` (clsx + tailwind-merge)

---

## 3. Colors

UniqueMe runs on a single palette: **Midnight + Champagne**. Deep midnight navy backgrounds, pale champagne and blush gold accents, warm ivory text. All values use the **oklch** color space and are defined as CSS custom properties in `globals.css`, bridged to Tailwind via `@theme inline`.

### Semantic tokens (dark only)

| Token | Hex reference | oklch value | Usage |
|---|---|---|---|
| `background` | `#0E1320` | `oklch(0.16 0.025 265)` | Deep midnight navy — page background |
| `foreground` | `#F2EEE6` | `oklch(0.95 0.015 85)` | Warm ivory — primary text |
| `card` | `#161C2D` | `oklch(0.21 0.028 265)` | Raised surface — cards, dialogs |
| `card-foreground` | `#F2EEE6` | `oklch(0.95 0.015 85)` | Text on cards |
| `popover` | `#161C2D` | `oklch(0.21 0.028 265)` | Dropdowns, popovers |
| `popover-foreground` | `#F2EEE6` | `oklch(0.95 0.015 85)` | Text on popovers |
| `primary` | `#D9B68C` | `oklch(0.79 0.07 75)` | Pale champagne — CTAs, primary accents, focus |
| `primary-foreground` | `#0E1320` | `oklch(0.16 0.025 265)` | Midnight text on champagne |
| `secondary` | `#2A3147` | `oklch(0.32 0.03 265)` | Secondary buttons, subtle chips |
| `secondary-foreground` | `#F2EEE6` | `oklch(0.95 0.015 85)` | Text on secondary |
| `accent` | `#EBD2AC` | `oklch(0.86 0.06 80)` | Soft blush gold — hover states, highlights |
| `accent-foreground` | `#0E1320` | `oklch(0.16 0.025 265)` | Midnight text on accent |
| `muted` | `#1C2336` | `oklch(0.24 0.028 265)` | Subdued surface — input backgrounds, soft fills |
| `muted-foreground` | `#6E7388` | `oklch(0.55 0.025 265)` | Slate caption — placeholders, secondary captions |
| `border` | `#232A3C` | `oklch(0.28 0.025 265)` | Navy hairline borders, dividers |
| `input` | `#2A3147` | `oklch(0.32 0.03 265)` | Input borders |
| `ring` | `#D9B68C` | `oklch(0.79 0.07 75)` | Champagne focus ring |
| `destructive` | `#B5605A` | `oklch(0.55 0.12 25)` | Muted coral-red — error states, destructive actions |
| `destructive-foreground` | `#F2EEE6` | `oklch(0.95 0.015 85)` | Ivory on destructive |

### Elevation by lightness

Dark UIs don't show drop shadows well, so depth comes from **surface lightening**. Each elevation step is roughly +5% lightness in oklch:

```
background  L=0.16  page
card        L=0.21  raised card, dialog
muted       L=0.24  input bg, hover surface
secondary   L=0.32  pressed state, chip
border      L=0.28  hairline
```

A card on the page is visible because it is one step lighter — not because of a hard shadow.

### Gilt highlight utility

For hero headlines and key marketing moments, a champagne → blush-gold gradient on text:

```css
.gilt {
  background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}
```

Use sparingly — once per hero, never on body copy, never on UI text.

### Champagne glow utility

For primary CTAs and the focal card on a surface:

```css
.glow-champagne {
  box-shadow: 0 0 32px -8px oklch(0.79 0.07 75 / 0.25);
}
.glow-champagne:hover {
  box-shadow: 0 0 40px -8px oklch(0.79 0.07 75 / 0.4);
  transition: box-shadow 250ms ease-out;
}
```

Respect `prefers-reduced-motion`: disable the transition when set.

### Status colors (ad-hoc)

These sit outside the core token system but must stay tonally consistent with the palette:

- **Success:** `text-emerald-300` / `bg-emerald-500/20` — muted, never bright spring green
- **Warning:** `text-amber-300` / `bg-amber-500/20` — sits in the gold family
- **Error:** `text-destructive` (token) — the muted coral-red, not pure red

### Tokens we deliberately do NOT define

- Sidebar tokens — no sidebar in v1
- Chart tokens — defer until the dashboard ships
- A light-mode variant — a future brand conversation, not a token swap

---

## 4. Typography

### Font families

| Token | Font | Usage |
|---|---|---|
| `--font-fraunces` | Fraunces (display serif, optical sizing on, weights 400/500/600) | All `h1`–`h3` headings, hero, marketing pull-quotes |
| `--font-geist-sans` | Geist (variable) | All UI text, body copy, `h4`+, buttons, forms |
| `--font-geist-mono` | Geist Mono | Code blocks only |

Body has `font-feature-settings: "rlig" 1, "calt" 1` and `antialiased` enabled. Fraunces should be loaded with `axes: ["opsz", "SOFT", "WONK"]` and `display: "swap"`.

### Heading rule

> `h1`, `h2`, `h3` → Fraunces, `tracking-tight`, weight 500 default (600 for hero only). `h4` and below → Geist sans, `font-semibold`.

Italic Fraunces is encouraged for the hero subtitle, pull-quotes, and marketing copy moments — italic serif on midnight is a UniqueMe signature.

### Type scale

| Class | Size | Family | Usage |
|---|---|---|---|
| `text-xs` | 12px | Geist | Timestamps, helper text, badge labels |
| `text-sm` | 14px | Geist | Captions, dense UI, table cells |
| `text-base` | 16px | Geist | **Body copy minimum on midnight** |
| `text-lg` | 18px | Geist | Lead paragraphs, dialog body |
| `text-xl` | 20px | Fraunces (h3) | Card titles, section headings |
| `text-2xl` | 24px | Fraunces (h2) | Sub-section headings |
| `text-3xl` | 30px | Fraunces (h2) | Page titles |
| `text-4xl` | 36px | Fraunces (h1) | Major page heroes |
| `text-6xl` | 60px | Fraunces (h1) | Marketing hero (`md+`) |
| `text-7xl` | 72px | Fraunces (h1) | Landing hero (`lg+`) |

> **Never go below `text-base` (16px) for primary body content.** Champagne and ivory on midnight start to fatigue the eye below that — luxury type is generous.

### Font weights

| Class | Weight | Usage |
|---|---|---|
| `font-normal` | 400 | Fraunces body in pull-quotes |
| `font-medium` | 500 | Fraunces headings (default), Geist buttons |
| `font-semibold` | 600 | Fraunces hero, Geist card titles |
| `font-bold` | 700 | Reserved — use sparingly, ideally never |

### Line height & tracking

| Class | Usage |
|---|---|
| `leading-none` | Hero headlines (Fraunces, large sizes) |
| `leading-tight` | All `h1`–`h3` (Fraunces) |
| `leading-7` | Body paragraphs (16px Geist) |
| `leading-8` | Lead paragraphs (18px Geist) |
| `tracking-tight` | All Fraunces headings |
| `tracking-wide` | Small caps labels, badge text |

---

## 5. Spacing

### Container pattern

```
container mx-auto px-5 sm:px-8 lg:px-12
```

UniqueMe uses **more generous gutters than typical SaaS** — luxury layouts need air. Never tighter than `px-5` on mobile.

### Page vertical rhythm

| Class | Usage |
|---|---|
| `py-3 sm:py-4` | Header |
| `py-6 sm:py-8` | Footer |
| `py-12 sm:py-16 lg:py-24` | Standard content pages |
| `py-20 sm:py-28 lg:py-36` | **Hero / landing sections** |

### Section gaps

| Class | Usage |
|---|---|
| `space-y-2` | Tight form-field groups |
| `space-y-4` | Form sections, dialog content |
| `space-y-6` | Card content sections |
| `space-y-8` | Page-level sections (dashboard) |
| `space-y-12` | Marketing landing sections |
| `space-y-16` | Hero-to-content transition |

### Max widths

| Class | Value | Usage |
|---|---|---|
| `max-w-md` | 28rem | Login / register / error cards |
| `max-w-lg` | 32rem | Dialog content (sm+) |
| `max-w-2xl` | 42rem | Single-question prompt screens |
| `max-w-3xl` | 48rem | **Content-heavy pages — questionnaire, post review, settings** |
| `max-w-5xl` | 64rem | Editorial hero with side visual |
| `max-w-6xl` | 72rem | Dashboard, post grid |

Default to `max-w-3xl` for editorial content unless a layout explicitly needs more width — narrower columns read more premium.

### Padding

| Class | Usage |
|---|---|
| `p-2` | Code blocks, icon buttons |
| `p-4` | Compact list items |
| `p-6` | Standard cards |
| `p-8` | **Default for cards — generous padding is on-brand** |
| `p-10` lg+ | Hero cards, focal surfaces |

---

## 6. Border Radius

| Token | Value | Class |
|---|---|---|
| `--radius` | `0.875rem` (14px) | Base |
| `--radius-sm` | `calc(--radius - 6px)` = 8px | `rounded-sm` |
| `--radius-md` | `calc(--radius - 4px)` = 10px | `rounded-md` |
| `--radius-lg` | `var(--radius)` = 14px | `rounded-lg` |
| `--radius-xl` | `calc(--radius + 4px)` = 18px | `rounded-xl` |
| `--radius-2xl` | `calc(--radius + 10px)` = 24px | `rounded-2xl` |
| — | 9999px | `rounded-full` |

**Usage:**

- `rounded-md` — Inputs, textareas, dropdown items, code blocks
- `rounded-lg` — Secondary buttons, badges (non-pill), tooltips
- `rounded-2xl` — **Cards, dialogs, hero containers (signature)**
- `rounded-full` — **Primary buttons (signature pill shape), avatars, status dots**

Softer radii read warmer and more refined than the shadcn defaults.

---

## 7. Shadows & Elevation

Drop shadows alone don't read on dark backgrounds — UniqueMe combines **surface lightening** (see § 3) with soft, low-spread shadows and a champagne glow for focal moments.

### Shadow tiers (all custom, in `@theme inline`)

```css
--shadow-soft:  0 1px 2px 0 oklch(0 0 0 / 0.4), 0 1px 3px 0 oklch(0 0 0 / 0.3);
--shadow-lift:  0 4px 12px -4px oklch(0 0 0 / 0.5), 0 2px 6px -2px oklch(0 0 0 / 0.3);
--shadow-float: 0 16px 40px -12px oklch(0 0 0 / 0.6), 0 8px 16px -6px oklch(0 0 0 / 0.4);
```

| Utility | Usage |
|---|---|
| `shadow-soft` | Default card resting state |
| `shadow-lift` | Card hover, raised input on focus |
| `shadow-float` | Dialogs, popovers, focal hero card |

Avoid stock Tailwind `shadow-lg` / `shadow-xl` — they're tuned for light mode and look muddy on midnight.

### Champagne glow

Reserved for the single primary CTA on a surface, the focal hero card, or active toggle states. See § 3 for the utility class. **One glow per viewport** is the rule — more and it stops feeling premium.

---

## 8. Layout Patterns

These four patterns cover ~90% of UniqueMe surfaces. Every new page should map to one of them or have a strong reason not to.

### A. Editorial hero (marketing, dashboard headers)

```
grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12
  ├─ headline block  → md:col-span-7
  └─ supporting visual / card → md:col-span-5
```

- Asymmetric on `md+`, single column on mobile.
- **Mobile rule:** image / visual stacks *above* the headline — keeps emotional weight at the top.
- Headline uses Fraunces `text-4xl sm:text-5xl md:text-6xl lg:text-7xl tracking-tight`.
- One champagne CTA. Optional secondary ghost button.

### B. Editorial content page (questionnaire, post review, settings)

```
container mx-auto px-5 sm:px-8 lg:px-12
  └─ max-w-3xl mx-auto
       └─ space-y-8 (or space-y-12 between major sections)
```

- Narrow column, generous vertical rhythm.
- Cards (`bg-card rounded-2xl p-8 shadow-soft`) for each logical section.
- Section headings use Fraunces `text-2xl` with a small ivory rule (`border-t border-border pt-8`) above.

### C. Card-on-midnight grid (post grid, dashboard tiles)

```
grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8
```

- Each card: `bg-card rounded-2xl p-6 shadow-soft transition-all duration-300 hover:shadow-lift hover:-translate-y-0.5`.
- Image-forward cards: image fills top of card edge-to-edge (`rounded-t-2xl`), copy below in `p-6`.
- Never more than 3 columns — preserves whitespace.

### D. Auth / focal-task screen (login, single prompt)

```
flex min-h-[calc(100vh-4rem)] items-center justify-center px-5
  └─ Card w-full max-w-md p-8 shadow-float glow-champagne (optional on focal card)
```

- Single card, centered, breathing room around it.
- Background can use a subtle radial gradient from `accent/8%` to transparent for warmth.

### Auth background utility

```css
.auth-bg {
  background-image: radial-gradient(
    ellipse at 50% 0%,
    oklch(0.79 0.07 75 / 0.08) 0%,
    transparent 60%
  );
}
```

---

## 9. Components (shadcn/ui)

All components live in `src/components/ui/`. The defaults below override or extend shadcn's stock variants for UniqueMe.

### Button

Variants (6) × Sizes (4) — keep shadcn's CVA structure, override styling:

| Variant | Shape | Background | Text | Usage |
|---|---|---|---|---|
| `default` | **`rounded-full`** | `bg-primary` (champagne) | `text-primary-foreground` (midnight) | Primary action — one per surface |
| `secondary` | `rounded-full` | `bg-secondary` (navy) with `border border-primary/40` | `text-foreground` | Secondary action |
| `outline` | `rounded-lg` | transparent + `border-border` | `text-foreground` | Tertiary / inline |
| `ghost` | `rounded-lg` | transparent, hover `bg-muted` | `text-foreground` | Nav, icon-only |
| `destructive` | `rounded-lg` | `bg-destructive` | `text-destructive-foreground` | Delete actions |
| `link` | — | — | `text-primary underline-offset-4 hover:underline` | Inline text links |

| Size | Height | Padding |
|---|---|---|
| `sm` | h-9 | px-4 |
| `default` | h-11 | px-6 |
| `lg` | h-12 | px-8 |
| `icon` | size-11 | — |

> Heights are taller than shadcn defaults — luxury buttons have more substance.

The primary CTA on a hero or focal card should also receive `glow-champagne`.

### Card

`bg-card text-card-foreground rounded-2xl border border-border shadow-soft`

Padding defaults: `p-8` (override shadcn's `p-6`). Sub-components (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) keep their shadcn structure.

`CardTitle` uses Fraunces `text-xl font-medium tracking-tight`. `CardDescription` uses Geist `text-sm text-muted-foreground leading-7`.

### Input / Textarea

- Background: `bg-muted` (one elevation step above page)
- Border: `border border-input rounded-md`
- Height: `h-11` (input), `min-h-24` (textarea)
- Padding: `px-4`
- Font: `text-base md:text-sm` (16px on mobile prevents iOS zoom)
- Focus: `focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-[3px]`
- Placeholder: `placeholder:text-muted-foreground/70`
- Invalid: `aria-invalid:border-destructive aria-invalid:ring-destructive/20`

For marketing forms, label can use Fraunces `text-sm font-medium tracking-wide uppercase` — small-caps serif feels editorial.

### Label

Geist, `text-sm font-medium`, default color `text-foreground`. Spacing above input: `mb-2`.

### Badge

`rounded-full border px-3 py-1 text-xs font-medium`

| Variant | Style | Usage |
|---|---|---|
| `default` | `bg-primary/15 text-primary border-primary/30` | Champagne tint — status, tags |
| `secondary` | `bg-muted text-muted-foreground border-border` | Neutral |
| `outline` | transparent + `border-border` | Subtle |

No destructive variant in v1 — use inline error states instead.

### Dialog

- Overlay: `bg-background/80 backdrop-blur-sm`
- Content: `bg-card rounded-2xl border border-border shadow-float p-8`
- Animation: fade + zoom-in-95, 300ms ease-out. Add a soft champagne glow on initial render that fades after 600ms (focal arrival cue).

### DropdownMenu

- Content: `bg-popover rounded-lg border border-border shadow-float p-2 min-w-[10rem]`
- Items: `rounded-md px-3 py-2 text-sm`, hover `bg-muted`
- Destructive items: `text-destructive hover:bg-destructive/10`

### Spinner

`Loader2` icon with `animate-spin`. Sizes: `sm` (h-4 w-4), `md` (h-5 w-5), `lg` (h-7 w-7). Default color: `text-primary` (champagne).

### Toast (Sonner)

- Background: `bg-card`
- Border: `border-border`
- Radius: `rounded-2xl`
- Icons by state:
  - success → `Check` in emerald-300
  - error → `AlertCircle` in destructive
  - info → `Info` in primary (champagne)
  - loading → `Loader2` in primary

Position: bottom-right on desktop, top on mobile. Duration: 4s default — luxury doesn't rush.

---

## 10. Iconography

**Library:** Lucide React. **Default stroke width: `1.5`** (not Lucide's stock `2`). Thinner strokes read more refined on midnight.

### Sizing

| Size | Classes | Usage |
|---|---|---|
| XS | `size-3` | Inline badge icons |
| SM | `size-4` | Standard inline icons, button icons |
| Default | `size-5` | UI controls, nav icons |
| MD | `size-6` | Card header icons |
| LG | `size-8` | Empty state, hero feature icons |
| XL | `size-12` | Marketing feature blocks |

### Color

`currentColor` against ivory `foreground` by default. Active/selected states use `text-primary` (champagne). Status icons borrow from § 3 (emerald/amber/destructive).

### Commonly used

`Bot`, `Sparkles`, `Calendar`, `Image`, `Send`, `Check`, `X`, `ArrowRight`, `ChevronDown`, `Loader2`, `Settings`, `User`, `LogOut`, `Instagram`, `Facebook`, `Linkedin`, `Edit3`, `Trash2`, `RefreshCw`, `AlertCircle`, `Info`.

---

## 11. Motion

Slow, deliberate, never jittery. Default duration is **300–500ms**, default easing is `ease-out`. Bouncy springs are off-brand.

### Custom keyframes

| Name | Effect | Duration | Easing |
|---|---|---|---|
| `fade-in` | Opacity 0 → 1 | 500ms | ease-out |
| `fade-up` | Opacity 0 → 1 + translateY(12px → 0) | 500ms | ease-out |
| `scale-in` | Opacity 0 → 1 + scale(0.96 → 1) | 300ms | ease-out |
| `editorial-reveal` | Staggered children: opacity 0 → 1 + translateY(8px → 0), 60–80ms stagger delay | 500ms per child | ease-out |

Use via `animate-fade-in`, `animate-fade-up`, `animate-scale-in`, `animate-editorial-reveal` (parent class — children opt in with `[&>*]:animate-fade-up` and custom delays).

### Transition classes

| Class | Usage |
|---|---|
| `transition-colors duration-200` | Links, nav hover |
| `transition-opacity duration-300` | Reveal-on-hover, avatar |
| `transition-all duration-300 ease-out` | Card interactive hover |
| `transition-shadow duration-250` | Champagne glow intensification |
| `transition-[color,box-shadow] duration-300` | Input/textarea focus |

### Card hover

```css
.card-interactive {
  @apply transition-all duration-300 ease-out;
}
.card-interactive:hover {
  @apply shadow-lift -translate-y-0.5;
}
```

### Reduced motion

Respect `prefers-reduced-motion: reduce` globally — disable the champagne glow animation, replace transforms with opacity-only transitions, and skip `editorial-reveal` stagger.

---

## 12. Accessibility & Responsive Checklist

UniqueMe is mobile-first and WCAG AA at minimum. Every component must satisfy:

### Contrast (verified against the palette)

| Combination | Ratio | Verdict |
|---|---|---|
| Ivory `#F2EEE6` on midnight `#0E1320` | ≈ 14.5:1 | AAA ✓ |
| Champagne `#D9B68C` on midnight `#0E1320` | ≈ 9.4:1 | AAA ✓ |
| Midnight `#0E1320` on champagne `#D9B68C` (CTA text) | ≈ 9.4:1 | AAA ✓ |
| Slate caption `#6E7388` on midnight `#0E1320` | ≈ 4.6:1 | AA for **large text only** — never use for body |
| Destructive `#B5605A` on midnight `#0E1320` | ≈ 4.7:1 | AA ✓ |

If a new color is proposed, run it through a contrast checker against both `background` and `card` before adding.

### Touch & input

- Minimum touch target: **44 × 44 px** (matches the `h-11` button default).
- Mobile-first: every layout example starts with the mobile rule, then progressively enhances at `sm:` / `md:` / `lg:`.
- iOS input zoom prevention: form inputs use `text-base md:text-sm` so mobile renders at 16px.

### Keyboard & focus

- Visible focus ring on every interactive element: `focus-visible:ring-ring focus-visible:ring-[3px] focus-visible:outline-none`.
- Champagne ring `oklch(0.79 0.07 75)` on midnight is unmistakable.
- `Skip to main content` link in the header (visually hidden, visible on focus).

### Motion preferences

- `prefers-reduced-motion: reduce` disables the champagne glow animation, hero stagger, and card lift transforms.
- Static fallbacks must still convey state (color change, opacity change, border change).

### Responsive breakpoints (Tailwind defaults)

- `sm:` 640px — padding / type adjustments
- `md:` 768px — grid columns appear, asymmetric heroes activate
- `lg:` 1024px — wide gutters, hero scales to `text-7xl`
- `xl:` 1280px — used sparingly, mostly for marketing pages

---

## 13. Dark Mode

UniqueMe is dark-only. The `next-themes` provider is configured with `forcedTheme="dark"`, no toggle is exposed, and `globals.css` defines tokens directly on `:root` (no `.dark` selector branching).

A light-mode variant would require a brand-level conversation — the champagne palette is identity-defining and loses most of its luxury cue on cream backgrounds. Do not add a light variant without that conversation.

---

## 14. Branding

### Logo text (wordmark)

```
font-fraunces font-medium tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent
```

Italic optional for marketing surfaces.

### Logo icon container

```
w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/30 flex items-center justify-center
```

Hero variant: `w-14 h-14 rounded-2xl` with the icon at `size-7` in `text-primary`.

### Voice in microcopy

- No exclamation points.
- No hyperbole ("amazing", "incredible", "best").
- Use plain, confident verbs: "Generate," "Review," "Schedule," "Publish."
- Empty-state copy is one sentence + one action. Example: *"Nothing scheduled yet. Add your first post →"*

---

## 15. What lives outside this document

- **Logo / wordmark asset:** This system reserves the slot but doesn't produce the SVG.
- **Marketing imagery:** Photography direction (warm, low-key lighting, real businesses — not stock) belongs in a separate brand guide once we have one.
- **Light mode:** Out of scope this phase. Future brand conversation required.
- **Charts / data viz:** Out of scope until the dashboard ships. Will reuse the gold/peach family.
- **Sidebar:** Out of scope until the app introduces one.
