# Task 10: NextBatchBanner — Dashboard

## Status
not started

## Wave
3

## Description

A `<NextBatchBanner />` component rendered on `/dashboard` for paid users only. Always present, contents flip based on `canGenerate`:

- **Allowed-to-generate** (user has at least one prior batch, 7 days elapsed): "Your 7 days are up — you can create your next batch." with CTA to `/create`.
- **Quota-active** (within 7-day window): "Next batch in {N} days. Your weekly cycle resets 7 days after your last batch." No CTA.

**Never implies a batch is pre-made** (the user provides theme + importantThing + post-length on `/create`).

## Dependencies

**Depends on:** task-03 (reads `canGenerate` + `nextResetAt`)
**Blocks:** none
**Context from dependencies:** task-03 provides `canGenerate(userId)` and `nextResetAt(userId)`.

## Files to Modify

- `src/components/dashboard/next-batch-banner.tsx` (new)
- `src/app/(app)/(onboarded)/dashboard/page.tsx` (modified) — render the banner for paid users only

## Implementation Steps

### 1. Component

```tsx
type Props = {
  state: "allowed" | "quota_active";
  nextResetAt: Date | null; // null when state === "allowed"
};

export function NextBatchBanner({ state, nextResetAt }: Props) {
  if (state === "allowed") {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8 ...">
        <h2 className="font-fraunces text-xl ...">Your 7 days are up — you can create your next batch.</h2>
        <Button asChild className="rounded-full glow-champagne mt-4">
          <Link href="/create">Create this week&apos;s posts →</Link>
        </Button>
      </div>
    );
  }
  // quota_active — uses a <NextResetCountdown nextResetAt={...} /> client child
  // to render "in N days" with timezone-correct day math.
  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 ...">
      <h2 className="font-fraunces text-xl ...">
        Next batch in <NextResetCountdown at={nextResetAt!} /> days.
      </h2>
      <p className="text-sm text-muted-foreground mt-2">
        Your weekly cycle resets 7 days after your last batch.
      </p>
    </div>
  );
}
```

### 2. `<NextResetCountdown />` (client child)

Tiny client component that computes `Math.ceil((nextResetAt.getTime() - Date.now()) / 86_400_000)` and renders the number. Re-runs `useMemo` on mount (doesn't auto-tick — refresh is fine for Phase 3).

### 3. Dashboard wiring

In `dashboard/page.tsx`:

- Already loads `subscription` via `checkSubscription`. Add:
  - If `subscription.status === "trial"` → don't render the banner.
  - If `subscription.plan === "free_trial"` → don't render the banner (defensive duplicate of the above).
  - Else: call `canGenerate(userId)` and `nextResetAt(userId)`.
    - `canGenerate.allowed === true` AND user has at least one prior batch → `<NextBatchBanner state="allowed" nextResetAt={null} />`.
    - `canGenerate.reason === "weekly_cap_active"` → `<NextBatchBanner state="quota_active" nextResetAt={canGenerate.nextResetAt} />`.
    - Other gate reasons (`overage`, `inactive`) → don't render. Those surface on `/create` and `/settings`.
    - First-time paid user (no prior batch) → don't render. They land at `/create` empty form.

### 4. Placement

- Top of the dashboard main column, above whatever existing content is there.
- One champagne-bordered card. Generous padding. Single primary CTA in the allowed state, no CTA in the quota-active state.

## Acceptance Criteria

- [ ] Trial users do NOT see the banner.
- [ ] First-time paid user (no batches yet) does NOT see the banner.
- [ ] Paid user with last batch >7d ago → banner shows allowed-state with CTA to `/create`.
- [ ] Paid user with last batch <7d ago → banner shows quota-active state with correct day count, no CTA.
- [ ] Banner copy contains the exact phrase "Your 7 days are up" in the allowed state. No "ready", no "pre-made", no "waiting for you" language.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` exit 0.

## Notes

- The countdown doesn't auto-tick. If a user leaves the dashboard open for 23 hours, the number could be wrong by a day. Acceptable for Phase 3 — a page refresh fixes it.
- Don't add an icon to the headline. Brand voice is restrained (DESIGN.md § 1 "intentional, no decorative chrome").
- The quota-active state is informational, not an error. Don't use destructive coloring; use the same neutral card surface as the rest of the dashboard.
