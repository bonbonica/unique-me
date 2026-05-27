# Task 06: Onboarding — Network Platforms Picker

## Status
not started

## Wave
2

## Description

Ensure the onboarding form captures `profiles.platforms` (Facebook / Instagram / LinkedIn multi-select). The schema column already exists from Phase 1; this task confirms or adds the UI step.

## Dependencies

**Depends on:** task-01 (schema — but `profiles.platforms` already exists from Phase 1; task-01 doesn't actually change it)
**Blocks:** task-08 (wizard reads `profile.platforms` for step count)
**Context from dependencies:** `profiles.platforms` is `text("platforms").array().notNull()`. `SelectionPlatform = "facebook" | "instagram" | "linkedin"` from task-01.

## Files to Investigate / Modify

- `src/components/onboarding/onboarding-form.tsx` — INVESTIGATE first; modify if missing the picker
- `src/app/(app)/onboarding/actions.ts` — INVESTIGATE first; modify if the action doesn't persist `platforms`
- `src/app/(app)/onboarding/page.tsx` — may need wiring depending on form structure

## Implementation Steps

### 0. Investigate the current onboarding flow

Read `onboarding-form.tsx` and `(app)/onboarding/actions.ts`. Look for:

- Is there already a field that writes to `profiles.platforms`?
- If yes, confirm it: (a) validates at least 1 platform, (b) defaults to none (opt-in), (c) uses the 3 platform values from `SelectionPlatform`.

If the picker is already there and complete, this task is just a confirmation pass — mark acceptance criteria, no code changes needed.

If absent or incomplete, proceed.

### 1. Add the multi-select toggle group (R11)

Position: after the tone-preference field, before the submit button.

Use a Toggle / ToggleGroup pattern. Three options:

| Value | Label | Icon |
|---|---|---|
| `facebook` | Facebook | `Facebook` from lucide-react |
| `instagram` | Instagram | `Instagram` |
| `linkedin` | LinkedIn | `Linkedin` |

Default selected: none. User must pick at least 1.

Visual: chip / pill style, matching DESIGN.md (`rounded-full`, champagne border on selected, muted on unselected). Group displayed horizontally on `sm+`, vertically on mobile.

```tsx
<div>
  <Label>Where do you want to post?</Label>
  <p className="text-sm text-muted-foreground">
    Pick the networks we should create content for. You can change this later.
  </p>
  <div className="mt-3 flex flex-wrap gap-2">
    {(["facebook", "instagram", "linkedin"] as const).map((p) => (
      <PlatformChip
        key={p}
        value={p}
        selected={selected.includes(p)}
        onToggle={() => toggle(p)}
      />
    ))}
  </div>
</div>
```

`<PlatformChip />` is a small in-file component or reusable in `src/components/onboarding/platform-chip.tsx`. Renders a `<button type="button">` with appropriate aria-pressed and visual states.

### 2. Validation

Client-side: disable Submit until `selected.length >= 1`. Show inline helper text *"Pick at least one network."* when zero selected and user has touched the form.

Server-side: in the onboarding server action, validate the incoming array contains 1–3 of the three known values. Reject otherwise (return form error). Use a Zod schema:

```ts
const platformsSchema = z.array(z.enum(["facebook", "instagram", "linkedin"]))
  .min(1, "Pick at least one network.")
  .max(3);
```

### 3. Persistence

The server action writes the array directly to `profiles.platforms` along with the rest of the profile insert/update. No schema change needed.

```ts
await db.insert(profiles).values({
  // ... existing fields ...
  platforms: validatedPlatforms,
});
```

### 4. Migration consideration for existing users

If any Phase 1 users exist with `profiles.platforms = []` (empty array, technically valid for the existing NOT NULL constraint since arrays can be empty):

- The wizard in task-08 has a defensive redirect to `/onboarding` when `platforms.length === 0`. No action needed in this task — the wizard handles it.

## Acceptance Criteria

- [ ] Onboarding form includes a Facebook / Instagram / LinkedIn multi-select toggle group
- [ ] At least 1 platform required (client-side AND server-side validation)
- [ ] Selected platforms persist to `profiles.platforms` on submit
- [ ] If a user revisits onboarding (Settings → edit profile, post-Phase-2), the current selections are pre-filled — but this is out of scope; just don't break it for the future
- [ ] `npm run lint` and `npm run typecheck` clean
- [ ] Manual test: sign up as new user, complete onboarding, verify `platforms` array in Drizzle Studio

## Notes

- DO NOT add per-network post-count questions ("how many FB posts per week?"). That's future-enhancement scope per § 8.5 of the spec.
- The "edit later in Settings" UI is out of scope for Phase 2 entirely.
