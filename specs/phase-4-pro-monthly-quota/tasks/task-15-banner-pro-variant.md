# Task 15: NextBatchBanner — Pro Variant Copy

## Status
not started

## Wave
4

## Description

Add a Pro variant to `<NextBatchBanner />` so paid Pro users see usage and reset countdown:

- **Pro at-cap** (`used === 4`) → "{used} of 4 batches used · Next reset in {N} days." No CTA.
- **Pro under-cap with prior usage** (`0 < used < 4`) → same copy shape; still no CTA (creating from the banner is fine but not the primary action — the topbar pill + main `/create` button cover that).
- **Pro 0 used** → existing "Your 7 days are up — you can create your next batch." copy stays. *(Or update to "Ready when you are" if Phase 3 copy implies "7 days"; verify at task time.)*
- **Starter / Trial** → existing copy, unchanged.

Banner `state` value stays `"quota_active"` — copy branches on plan internally. Discriminated-union shape may need a Pro-only field for `used`.

## Dependencies

**Depends on:** task-06 (`snapshot.proQuota`)
**Blocks:** task-19
**Context from dependencies:** task-06 provides `proQuota.used`, `proQuota.periodEndsAt`.

## Files to Modify

- `src/components/dashboard/next-batch-banner.tsx` (modified)
- `src/app/(app)/(onboarded)/dashboard/page.tsx` (modified) — pass `proQuota` to the banner

## Implementation Steps

### 1. Extend banner props

Current shape:
```ts
type Props =
  | { state: "allowed" }
  | { state: "quota_active"; nextResetAt: Date };
```

New shape:
```ts
type Props =
  | { state: "allowed"; plan: "starter" | "trial" | "pro_zero_used" }
  | { state: "quota_active"; plan: "starter"; nextResetAt: Date }
  | { state: "quota_active"; plan: "pro"; used: number; periodEndsAt: Date };
```

Alternative if exhaustive enums become noisy: keep `{ state: "quota_active"; nextResetAt: Date; pro?: { used: number; periodEndsAt: Date } }`. Pick whichever fits the existing file style — discriminated union is preferred when there are >2 branches.

### 2. Update copy branches

```tsx
if (props.state === "quota_active" && props.plan === "pro") {
  const daysLeft = daysFromNow(props.periodEndsAt);
  return (
    <Banner>
      <BannerCopy>
        {props.used} of 4 batches used · Next reset in {daysLeft} {daysLeft === 1 ? "day" : "days"}.
      </BannerCopy>
    </Banner>
  );
}
```

Keep the Starter and "allowed" branches untouched.

### 3. Update `dashboard/page.tsx`

Where the banner currently receives `state` + `nextResetAt`, augment the props based on plan + `proQuota`:

```tsx
const bannerProps: BannerProps =
  gate.allowed
    ? { state: "allowed", plan: snapshot.plan === "pro" ? "pro_zero_used" : snapshot.plan === "starter" ? "starter" : "trial" }
    : snapshot.plan === "pro" && snapshot.proQuota
    ? { state: "quota_active", plan: "pro", used: snapshot.proQuota.used, periodEndsAt: snapshot.proQuota.periodEndsAt }
    : { state: "quota_active", plan: "starter", nextResetAt: gate.nextResetAt };
```

Match the actual existing shape of `gate` — this is illustrative.

### 4. Trial path

Trial users do NOT see this banner (per Phase 3). Don't add a trial branch — early-return at the dashboard page level if the user is on trial, same as before.

### 5. Mount sentinel

If the banner uses a client-side mount sentinel for day count (same pattern as the topbar pill), keep it. The "{used} of 4 batches used" string is deterministic and can render server-side; the day count requires client.

## Acceptance Criteria

- [ ] Banner props are a discriminated union covering Pro at-cap, Pro 0-used (allowed), Starter quota_active, and existing "allowed" states.
- [ ] Pro at-cap renders "{used} of 4 batches used · Next reset in {N} days."
- [ ] Pro under-cap with usage in flight still renders the at-cap shape (Per Phase 4 spec, the banner reports usage even when generation is allowed — verify with PM at task time, but default to "show usage when used > 0").
- [ ] Starter rendering is byte-for-byte identical to before.
- [ ] `dashboard/page.tsx` passes the right props based on plan + snapshot + gate.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- The current "Your 7 days are up" copy is Starter-flavored; for Pro 0-used (just rolled over), consider "Ready when you are." Decide at task time — keep change minimal.
- Banner has no CTA in the quota-active state (Phase 3 rule). Pro variant keeps the rule.
- A future iteration may want a usage bar (4 dots, 3 filled). Out of scope for Phase 4 — text only.
- Singular/plural: "1 day" vs "2 days." Handle inline as shown.
