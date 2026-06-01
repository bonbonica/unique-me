# Task 13: QuotaGatedScreen — Add monthly_quota Variant

## Status
not started

## Wave
4

## Description

Add a new `variant="monthly_quota"` to `<QuotaGatedScreen />` (the create-page gate component from Phase 3). Renders for Pro users who have used all 4 batches in the current period.

The page-level switch in `create/page.tsx` already maps `monthly_cap_active` → this variant (task 12). This task delivers the actual rendering.

## Dependencies

**Depends on:** task-02 (pricing constants for copy), task-12 (page switch already wired)
**Blocks:** task-19 (audit verifies the variant renders)
**Context from dependencies:** task-12 produces a TS-error against the existing component until this variant lands; this task closes that loop.

## Files to Modify

- `src/components/create/quota-gated-screen.tsx` (modified) — add `monthly_quota` variant

## Implementation Steps

### 1. Extend the discriminated-union prop type

The existing `Props` discriminated union (Phase 3) covers `"quota"`, `"overage"`, `"inactive"`. Add a fourth:

```ts
| {
    variant: "monthly_quota";
    nextResetAt: Date;
    batchesUsed: number;
  }
```

### 2. Add the rendering branch

Match the existing component's structure (same outer card, same Fraunces headline, same champagne CTA shape):

```tsx
if (props.variant === "monthly_quota") {
  return <MonthlyQuotaVariant nextResetAt={props.nextResetAt} batchesUsed={props.batchesUsed} />;
}
```

Then the `MonthlyQuotaVariant` component:

```tsx
function MonthlyQuotaVariant({ nextResetAt, batchesUsed }: { nextResetAt: Date; batchesUsed: number }) {
  // Client-side day count + weekday via Intl.DateTimeFormat — same pattern as
  // the existing QuotaVariant. Use useSyncExternalStore mount sentinel to avoid
  // SSR/CSR mismatch on the weekday string.
  return (
    <Card className="...">
      <CardHeader>
        <CardTitle className="font-fraunces text-3xl sm:text-4xl tracking-tight">
          You've used all 4 batches this period.
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-base leading-7 text-muted-foreground">
          Your monthly cycle resets on <ResetDate at={nextResetAt} /> — in <DaysRemaining at={nextResetAt} /> days.
        </p>
        <Button asChild>
          <Link href="/posts">Return to your current batch →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
```

Reuse whatever `ResetDate` / `DaysRemaining` / mount-sentinel helpers the existing `QuotaVariant` uses — do not duplicate them. If they're currently inline in `QuotaVariant`, extract to a shared helper inside the same file.

### 3. Copy review

- Lead: **"You've used all 4 batches this period."** (period in lowercase, no exclamation per DESIGN.md § 14).
- Body: "Your monthly cycle resets on {Weekday}, {Date} — in {N} days."
- CTA: "Return to your current batch →" → `/posts` deep-link.
- Match `<QuotaVariant />`'s tone and structure exactly. Same surface, different facts.

### 4. Do not surface `batchesUsed` in the copy

The user already knows they've used 4 ("all 4"). Showing "4 of 4 used" is redundant. The prop is accepted (and tested) but not rendered. If a future iteration wants "3 of 4 used" warning copy at the under-cap state, add then.

### 5. Storybook / visual smoke

If a Storybook stories file exists for the component, add one for the new variant. If not, skip — visual QA happens via task 20's manual E2E.

## Acceptance Criteria

- [ ] `<QuotaGatedScreen variant="monthly_quota" nextResetAt={...} batchesUsed={4} />` renders the new copy.
- [ ] Headline is Fraunces, large, tracking-tight per DESIGN.md.
- [ ] Body uses muted-foreground; CTA uses primary (champagne) pill.
- [ ] Reset weekday + days-remaining are computed client-side (browser timezone is authoritative).
- [ ] SSR/CSR mismatch on the weekday string is handled the same way `QuotaVariant` handles it (mount sentinel or equivalent).
- [ ] Existing variants (`quota`, `overage`, `inactive`) render byte-for-byte identical to before — visual diff in task 20.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The pattern of mapping reason code → variant in the page is intentional (Phase 3 design). Keeping the variant name (`monthly_quota`) distinct from the reason code (`monthly_cap_active`) means the component doesn't have to know about the service's vocabulary.
- "No exclamation points in microcopy" (DESIGN.md § 14). The copy above complies; double-check during implementation.
- Reduce-motion: any `animate-fade-up` or champagne glow on the card respects `prefers-reduced-motion` (DESIGN.md § 11).
