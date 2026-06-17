# Stage 4 — UI

**Goal:** user-visible feature. Add the padlock affordance + last-used badge to every library tile. Wire the Download all / Delete all buttons. Mount the cleanup reminder dialog when the user opens the app on a new month and is over the cap. Ship the post-download cleanup popup.

Read `spec.md` first, especially §UI changes.

**Prereq:** Stages 1, 2, 3 committed and green.

---

## Files to touch

1. `src/app/(app)/(onboarded)/library/page.tsx` — header buttons, pass cleanup state, count pill
2. `src/components/library/library-grid.tsx` — padlock affordance + last-used badge on tile
3. `src/components/library/cleanup-reminder-dialog.tsx` — NEW
4. `src/components/library/download-cleanup-prompt-dialog.tsx` — NEW
5. `src/components/library/delete-all-confirmation-dialog.tsx` — NEW
6. `src/app/(app)/(onboarded)/layout.tsx` — wire `checkMonthlyCleanupAction` server-side; mount a small client component that decides modal-vs-silent-cleanup-vs-nothing

---

## Steps

### 1. Library page header

`src/app/(app)/(onboarded)/library/page.tsx`:

- Change the count pill from `{count}/30` to `{count}/100`.
- Add a right-aligned button cluster: **Download all** and **Delete all**.
- Both buttons disabled when `images.length === 0`.

`Download all`:
- `<Button variant="secondary">` with `Download` icon (lucide).
- Click handler: render an `<a download href="/api/library/download">` and trigger `.click()` — OR just navigate via the anchor directly. After triggering download, open the post-download popup.

`Delete all`:
- `<Button variant="outline">` with `Trash2` icon. Use `text-destructive` for the icon to convey caution without leaving the design system.
- Click opens `delete-all-confirmation-dialog.tsx`.

### 2. Padlock affordance on library-grid tiles

`src/components/library/library-grid.tsx`:

Add a corner padlock button (top-left of each tile, mirroring Wave 2's top-right regenerate placement on post tiles).

```tsx
import { Lock, Unlock } from "lucide-react";

// ...inside the tile JSX, alongside the existing delete overlay
<button
  type="button"
  onClick={() => handleLockToggle(image.id, !image.lockedAt)}
  className={cn(
    "absolute top-3 left-3 inline-flex items-center justify-center rounded-md p-1.5 transition-colors",
    image.lockedAt
      ? "bg-primary/15 border border-primary/30 text-primary"
      : "text-muted-foreground/70 hover:text-foreground",
  )}
  aria-label={image.lockedAt ? "Unlock image" : "Lock image"}
  aria-pressed={image.lockedAt !== null}
>
  {image.lockedAt
    ? <Lock className="size-4" strokeWidth={1.5} aria-hidden />
    : <Unlock className="size-4" strokeWidth={1.5} aria-hidden />
  }
</button>
```

`handleLockToggle`:
- Optimistic UI: locally flip `image.lockedAt` immediately to `lock ? new Date() : null`.
- Fire `toggleLibraryImageLockAction(id, lock)`. On `{ok: false}` revert and toast.

`LibraryGrid` needs a local state mirror for `images` so optimistic updates are possible without revalidatePath round-trips. Initialize from the server-passed `images` prop.

### 3. Last-used badge on tile

Below the tile image (or absolutely-positioned bottom-left), render:

```tsx
<p className="absolute bottom-2 left-2 text-xs text-white/80 drop-shadow">
  {image.lastUsedAt ? `Used ${relativeTime(image.lastUsedAt)}` : `Added ${relativeTime(image.createdAt)}`}
</p>
```

`relativeTime` helper: simple "3d ago" / "2w ago" formatter. Already in the project? Check `src/lib/utils.ts` first. If not, write a tiny inline helper (don't pull a dep).

Use white text with drop-shadow because it sits on top of an arbitrary image. Reads on most images.

### 4. Delete-all confirmation dialog

`src/components/library/delete-all-confirmation-dialog.tsx` — new. Shadcn AlertDialog or Dialog.

Content:
- Title: "Delete all unlocked images?"
- Body: "Locked images will be kept. Unlocked images will be permanently deleted. This cannot be undone."
- Cancel + Confirm.

On confirm: call `deleteAllLibraryImagesAction("unlocked-only")`. Toast on success: "Deleted {n} images."

### 5. Download-all post-popup

`src/components/library/download-cleanup-prompt-dialog.tsx` — new. Shadcn Dialog.

Triggered from `library/page.tsx` immediately after the download anchor click.

Content:
- Title: "Download started"
- Body: "Your library is downloading. Now that you have copies, do you want to clear the library?"
- Two buttons stacked:
  - `Button variant="destructive"` — "Delete all images (including locked)" → calls `deleteAllLibraryImagesAction("all")`
  - `Button variant="outline"` — "Delete only unlocked" → calls `deleteAllLibraryImagesAction("unlocked-only")`
- X button in top-right (provided by shadcn Dialog by default).

Each delete option fires the action, shows a toast with the deleted count, and closes the dialog.

### 6. Cleanup reminder dialog

`src/components/library/cleanup-reminder-dialog.tsx` — new. Shadcn Dialog.

Props:
```ts
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  over: number;
  currentMonthYyyyMm: string;
};
```

Content:
- Title: "Your image library is full"
- Body: "You have {count} images saved, over the 100-image limit. We'll keep the ones you've locked 🔒 and remove the oldest unlocked images to make room."
- Tip: "Lock any images you want to keep before continuing."
- Checkbox: "Don't show this reminder again" (controlled local state).
- Cancel button.
- Proceed button (primary).

On Cancel: close without doing anything. `lastCleanupCheckMonth` stays unchanged so the modal will re-show next visit.

On Proceed:
- If checkbox ticked, call `dismissCleanupReminderAction()`.
- Call `runMonthlyCleanupAction(currentMonthYyyyMm)`.
- Toast: "Removed {result.deleted} unlocked images." (Or "No unlocked images to remove" if `deleted === 0` but `over > 0`.)
- Close the dialog.

### 7. Onboarded layout integration

`src/app/(app)/(onboarded)/layout.tsx` — server component (currently).

Render a small client component `<MonthlyCleanupGate />`:

- Mounts a client component that, on mount, reads the user's browser TZ month (`new Date().toLocaleString("en-CA", { year: "numeric", month: "2-digit" }).replace("/", "-")` or `Intl.DateTimeFormat` with the right options), then calls `checkMonthlyCleanupAction(currentYyyyMm)`.
- Based on the response:
  - `shouldShowReminder === true` → mount `<CleanupReminderDialog open={true} ... />`
  - `shouldShowReminder === false && cleanupNeeded === true` → call `runMonthlyCleanupAction(currentYyyyMm)` directly (silent). Show a small toast on completion if deleted > 0.
  - `cleanupNeeded === false` → do nothing.
- Run this AT MOST ONCE per session. Use a ref guard or sessionStorage flag.

The gate is a client component because it needs the browser TZ. The layout itself stays server-rendered; only the gate is `"use client"`.

### 8. Toast styling

All toasts go through Sonner. Already set up in `src/components/ui/sonner.tsx`. Use `toast.success`, `toast.error`, `toast.info` as needed. Voice: no exclamation points, plain confident verbs (DESIGN.md §14).

---

## Acceptance criteria

1. `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` all pass.
2. Library page header shows `count/100` pill + Download all + Delete all buttons.
3. Clicking padlock toggles lock state visibly. Refresh preserves. DB row's `lockedAt` flips.
4. Delete all → confirmation → only unlocked rows deleted. Toast confirms count.
5. Download all → ZIP downloads (browser shows save dialog) AND the post-download popup appears. Click "Delete only unlocked" or "Delete all incl. locked" → action fires + toast. Click X → no-op.
6. Open the app on the 1st of a new month (simulate by setting `lastCleanupCheckMonth` to last month for your test user) with >100 images → modal appears. Proceed → cleanup runs.
7. Same scenario with `monthlyCleanupReminderDismissed = true` → no modal, silent cleanup, toast confirms count.
8. Same scenario with ≤100 images → no modal, `lastCleanupCheckMonth` updated to current month.
9. Padlock icon clearly conveys "protected from deletion" — locked tile shows solid pill behind `Lock`, unlocked tile shows ghost outline `Unlock`.
10. No Wave 1/2 regressions. `/library` page still loads. Delete-single-tile still works.
11. No regressions on other routes. The `MonthlyCleanupGate` doesn't break dashboard, posts, schedule, or settings pages.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT build a Settings toggle to re-enable the cleanup reminder.
- Do NOT add a per-post library picker on the post tile — Wave 4.
- Do NOT add bulk upload from device.
- Do NOT add undo/restore window after auto-cleanup.
- Do NOT change the existing single-tile delete dialog.
- Do NOT add analytics / telemetry on padlock toggles or downloads.
- Do NOT use a Heart icon — the spec is locked on padlock semantics (`Lock` / `Unlock` from lucide-react).
