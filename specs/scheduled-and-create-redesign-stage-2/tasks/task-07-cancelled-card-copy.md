# Task 07: UnscheduledBatchCard — cancelled chip + CTA copy fix

## Status
not started

## Wave
3

## Description

Tighten the cancelled-state copy on `<UnscheduledBatchCard />` per D-S2-16. The state chip drops its inline `— re-schedule` suffix and becomes a plain `CANCELLED` (amber tint unchanged); the primary CTA on cancelled cards changes from `Open →` to `Open to reschedule →`. The recoverability cue moves from the chip into the verb, where it belongs. `reviewing` cards are untouched (`IN REVIEW` chip + `Open →` CTA).

This is a copy-only refactor of one component. The new `[Delete forever]` button is **not** in scope here — task-08 layers that on top once this lands.

## Dependencies

**Depends on:** none.
**Blocks:** task-08 (Delete-forever dialog wires its trigger button next to the CTA modified here, and re-edits the same file).
**Parallel with:** task-09, task-10 (different files).

## Files to Modify

- `src/components/create/unscheduled-batch-card.tsx` — chip label + per-status CTA label.

## Implementation Steps

### 1. Update the chip lookup

Open `src/components/create/unscheduled-batch-card.tsx`. The `STATE_CHIP` lookup at the bottom of the file currently reads:

```ts
const STATE_CHIP: Record<
  Data["status"],
  { label: string; variant: "default" | "outline"; className: string }
> = {
  reviewing: {
    label: "IN REVIEW",
    variant: "default",
    className: "",
  },
  cancelled: {
    label: "CANCELLED — re-schedule",
    variant: "outline",
    className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
};
```

Change the cancelled label to drop the suffix; leave the variant and amber className exactly as-is (warning family per DESIGN.md §3 — NOT destructive coral, because re-scheduling is recoverable):

```ts
cancelled: {
  label: "CANCELLED",
  variant: "outline",
  className: "bg-amber-500/15 text-amber-300 border-amber-500/30",
},
```

### 2. Per-status CTA label

The CTA is currently a single hardcoded `Open` string inside the `<Button asChild>`. Per D-S2-16, `reviewing` keeps `Open →` and `cancelled` becomes `Open to reschedule →`. Introduce a tiny per-status lookup next to `STATE_CHIP` so the JSX stays declarative:

```ts
const CTA_LABEL: Record<Data["status"], string> = {
  reviewing: "Open",
  cancelled: "Open to reschedule",
};
```

Then update the JSX:

```tsx
<Button asChild size="sm">
  <Link href={`/posts?batchId=${data.id}`}>
    {CTA_LABEL[data.status]}
    <ArrowRight
      className="ml-1 size-4"
      strokeWidth={1.5}
      aria-hidden="true"
    />
  </Link>
</Button>
```

Per DESIGN.md §9, the Button stays at the default variant (champagne pill, `rounded-full`) and `size="sm"` (`h-9 px-4`). No variant change — re-scheduling is still the primary action on a cancelled card.

### 3. Voice check

- `CANCELLED` — uppercase chip text, matches the existing `IN REVIEW` form.
- `Open to reschedule` — single confident verb phrase. No exclamation. No `re-schedule` hyphen (the chip used the hyphenated form; the CTA uses the closed `reschedule` — copy follows the Phase 4 / Stage-2 spec body exactly).
- Trailing `→` arrow comes from the existing `ArrowRight` icon, not a literal character — keep that as-is.

### 4. Stroke width

`ArrowRight` already passes `strokeWidth={1.5}` per DESIGN.md §10. No change needed; just verify the prop stays on the icon after the edit.

## Acceptance Criteria

- [ ] `STATE_CHIP.cancelled.label === "CANCELLED"` (no ` — re-schedule` suffix).
- [ ] `STATE_CHIP.cancelled.variant === "outline"` and `className` unchanged (amber tint preserved).
- [ ] `STATE_CHIP.reviewing` unchanged.
- [ ] Cancelled-card CTA renders `Open to reschedule →` (text + `<ArrowRight>` icon).
- [ ] Reviewing-card CTA renders `Open →` (unchanged).
- [ ] CTA stays `<Button asChild size="sm">` with the default champagne pill variant per DESIGN.md §9.
- [ ] Link target unchanged: `/posts?batchId=${data.id}`.
- [ ] No exclamation points (DESIGN.md §14).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.
- [ ] Visual snapshot at `/create` with one `reviewing` and one `cancelled` card shows the new copy; the existing `reviewing` card's chip + CTA are byte-identical to before.

## Notes

- DESIGN.md §3 explicitly notes the cancelled chip lives in the **warning** (amber) family, not the destructive (coral) family. Keep that tint — destructive coral here would imply error, not recoverability.
- Task-08 will edit the same file to add the `[Delete forever]` button next to this CTA. The two changes are serialised by listing task-08 with `Depends on: task-05, task-07` so the diffs land in order and the second commit doesn't fight a merge against the first. See task-08's Dependencies block for the explicit sequencing.

## Out of scope

- The new `Delete forever` action and its confirm dialog — that's task-08.
- Tooltip / hover affordances on the chip. Plain badge text is intentional per DESIGN.md §9 (Badge variant).
- Per-status background colour on the whole card. Only the chip changes between states; card chrome stays the standard `bg-card rounded-2xl shadow-soft`.
- Any change to the `reviewing` chip or its CTA. Reviewing is byte-identical to Stage-1.
- Server-side changes. `UnscheduledBatchCard` data still comes from `postService.getUnscheduledBatchesForUser` unchanged.
