# Task 16: /library page — functional grid

## Status
not started

## Wave
5

## Re-issue note

This task file was re-issued alongside task-15 after the Stage-2 spec update introduced the Cancel-vs-Delete contract (§0, D-S2-6 / D-S2-22). Architecturally the Library page is unchanged. The only edits are (a) empty-state copy that acknowledges the post-Wave-4.5 reality — per-post `cancelPost` no longer feeds the Library, only `deleteBatchForever` does today — and (b) a cross-reference to the reserved future `deletePost` (D-S2-22), which will be the per-post path that fills the Library when it ships.

## Description

Replace the Stage-1 `/library` placeholder ("Coming soon") with the real Image Library: a server-rendered responsive grid of the user's `library_images` rows (newest first), header showing `{N}/30 images`, per-tile destructive delete with confirm dialog. Empty state when the user has no images yet. Wires `imageService.listLibrary` for the read and `imageService.deleteLibraryImage` via a server action for the delete.

**Library inputs at task land.** Only `deleteBatchForever` populates `library_images` in Stage-2 (per D-S2-8). Per-post `cancelPost` does NOT feed the Library — it's non-destructive and preserves the image attached to the post (D-S2-6 / §0 Cancel-vs-Delete contract). The future destructive per-post `deletePost` (D-S2-22) is reserved but NOT built in Stage-2; when it ships it will be the second input. Most users will see the empty state for a while; the copy is written so that fact reads as design intent, not a bug.

## Dependencies

**Depends on:** task-03 (`image-service.ts` — `listLibrary` + `deleteLibraryImage`), task-01 (`library_images` table + migration applied).
**Blocks:** none.
**Parallel with:** task-15.

## Files to Create

- `src/components/library/library-grid.tsx` — client component. Owns dialog state for the per-tile delete. Renders the responsive image grid.
- `src/components/library/library-image-delete-dialog.tsx` — confirm dialog for per-image delete.
- `src/app/(app)/(onboarded)/library/actions.ts` — `deleteLibraryImageAction(libraryImageId)` server action.

## Files to Modify

- `src/app/(app)/(onboarded)/library/page.tsx` — full replacement. Drops `Sparkles` "Coming soon" placeholder, becomes server component with auth + `listLibrary` fetch.

## Implementation Steps

### 1. Server action

```ts
// library/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";

export async function deleteLibraryImageAction(
  libraryImageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: "unauthenticated" };

  const result = await imageService.deleteLibraryImage(
    session.user.id,
    libraryImageId,
  );
  if (!result.ok) return result;

  revalidatePath("/library");
  return { ok: true };
}
```

`imageService.deleteLibraryImage` (task-03) returns `DeletionResult = { ok: true } | { ok: false; error: 'not_found' | 'not_owned' }`. Mirror those keys exactly.

### 2. Server page

```tsx
// library/page.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";
import { LibraryGrid } from "@/components/library/library-grid";

/**
 * Stage-2 functional Image Library (D-S2-18). Newest-first responsive grid of
 * the user's library_images, capped at 30. Per-tile delete with confirm.
 * Editorial layout (DESIGN.md §8 pattern B), `max-w-5xl` for the grid breathing
 * room.
 */
export default async function LibraryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const images = await imageService.listLibrary(session.user.id);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Your image library
        </h1>
        <p className="text-sm text-muted-foreground">
          {images.length}/30 images
        </p>
      </header>

      {images.length === 0 ? (
        <p className="text-base text-muted-foreground leading-7">
          No images yet. Images move to your library when you delete a
          cancelled batch.
        </p>
      ) : (
        <LibraryGrid images={images} />
      )}
    </div>
  );
}
```

### 3. `<LibraryGrid />` (client)

```tsx
"use client";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { LibraryImageDeleteDialog } from "./library-image-delete-dialog";
import type { LibraryImage } from "@/lib/schema";

export function LibraryGrid({ images }: { images: LibraryImage[] }) {
  const [target, setTarget] = useState<LibraryImage | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {images.map((img) => (
          <div
            key={img.id}
            className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-card shadow-soft transition-all duration-300 ease-out hover:shadow-lift hover:-translate-y-0.5"
          >
            <Image
              src={img.imageUrl}
              alt={img.imagePrompt}
              fill
              sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
              className="object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 bg-gradient-to-t from-background/90 via-background/60 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setTarget(img)}
              >
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {target && (
        <LibraryImageDeleteDialog
          libraryImageId={target.id}
          open={!!target}
          onOpenChange={(open) => !open && setTarget(null)}
        />
      )}
    </>
  );
}
```

Notes on the tile:
- 1:1 aspect ratio (`aspect-square`) per spec §6.12.
- `rounded-2xl` per DESIGN.md §6 (signature card radius).
- Hover-lift uses the §11 card-interactive pattern (shadow-lift + small translate).
- The `[Delete]` overlay reveals on hover and on focus-within so keyboard users can still reach it.
- `next/image` `fill` + `sizes` for responsive optimization.

### 4. `<LibraryImageDeleteDialog />` (client)

Mirrors the Stage-1 `<CancelBatchDialog />` pattern — `useTransition`, Sonner toasts, calls the server action.

```tsx
"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteLibraryImageAction } from "@/app/(app)/(onboarded)/library/actions";

export function LibraryImageDeleteDialog({
  libraryImageId,
  open,
  onOpenChange,
}: {
  libraryImageId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteLibraryImageAction(libraryImageId);
      if (!result.ok) {
        toast.error(
          result.error === "not_found"
            ? "Image was already removed."
            : "Couldn't delete this image.",
        );
        onOpenChange(false);
        return;
      }
      toast.success("Image deleted.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Delete this image forever?
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-base leading-7 text-muted-foreground">
          The image is removed from your library and the underlying file is
          deleted. This cannot be undone.
        </DialogDescription>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Keep
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 5. Voice & tokens

- Header in Fraunces (DESIGN.md §4); count in Geist `text-sm text-muted-foreground`.
- Editorial pattern B (DESIGN.md §8): `max-w-5xl` (header + grid get a touch more width than the §8 default `max-w-3xl` so 4 columns at `lg:` breathe properly per spec §6.12).
- Grid: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6` per spec.
- Card radius `rounded-2xl`, hover-lift card pattern.
- Destructive button = warm coral per DESIGN.md §9.
- Dialog title in Fraunces `text-2xl tracking-tight font-medium`.
- No exclamation points (§14).

### 6. Empty state

When `listLibrary` returns `[]`, render the two-sentence empty state `"No images yet. Images move to your library when you delete a cancelled batch."` in muted foreground at body size. No CTA — images arrive via the `deleteBatchForever` flow on `/create` (per-post `cancelPost` does NOT feed the Library — see §0 Cancel-vs-Delete contract), and direct upload is out of scope (§8). The empty state is intentionally quiet, but the second sentence makes it obvious *why* the cap is rarely hit today, so the page doesn't read as broken to a user who never deletes batches.

## Acceptance Criteria

- [ ] `/library` no longer shows the "Coming soon" badge. Page renders the functional library.
- [ ] Header: `"Your image library"` (Fraunces h1) + `"{N}/30 images"` (muted, Geist `text-sm`).
- [ ] Grid: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6`, tiles are 1:1, `rounded-2xl`, with hover-lift transition.
- [ ] Newest-first order (`imageService.listLibrary` returns sorted; the page does no extra sort).
- [ ] Hover/focus reveals the `[Delete]` button overlay; clicking opens `<LibraryImageDeleteDialog />`.
- [ ] Confirm calls `deleteLibraryImageAction`; on success: toast `"Image deleted."`, page revalidates, tile disappears.
- [ ] On `not_found` error: toast `"Image was already removed."`, dialog closes, page revalidates.
- [ ] Empty state shows the two-sentence copy `"No images yet. Images move to your library when you delete a cancelled batch."` only (no CTA).
- [ ] Cap copy: header reads `0/30 images` when empty, `30/30 images` at cap.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build:ci` exit 0.

## Notes

- `revalidatePath('/library')` after delete is what removes the tile — the page is server-rendered and Next.js will re-fetch on the next paint via the `useTransition`.
- The cap is enforced at the **write** path (`imageService.retainImagesToLibrary` — task-03), not on this page. The header `{N}/30` is informational only.
- `imageService.listLibrary` returns rows ordered by `createdAt DESC`. Stage-2 doesn't expose a sort control; if added later it goes through the service, not the page.
- Hover-reveal on the delete button is fine on touch devices because Sonner toasts still surface the action result. If the design team wants always-visible delete on touch later, swap the overlay class — no component change needed.
- The `next/image` `fill` layout requires the parent to be `position: relative` (the `relative` class on the tile satisfies that).
- **D-S2-22 cross-reference for future implementers.** `postService.deletePost(sessionUserId, postId)` is reserved (D-S2-22) but NOT built in Stage-2. When it ships in a later spec, it will (a) call `imageService.retainImagesToLibrary` then `DELETE FROM posts` with cascade, and (b) become the second input that fills `library_images` (alongside `deleteBatchForever`). Do not add a per-post delete-image-from-Library-back-to-a-post flow, a direct upload UI, or a "send to library" affordance on a single post — all three are out of scope for this task and the next implementer should leave them out until D-S2-22 ships.

## Out of scope

- Direct image upload to `/library` (spec §8 names this — Stage-2 populates only via retention paths).
- Filter / sort / search controls.
- Multi-select + bulk delete.
- Per-image metadata panel (source, origin batch). The `originPostId` / `originBatchId` columns exist in `library_images` for future surfaces but aren't shown here.
- Drag-and-drop reuse into a new batch. Reuse arrives in a later spec.
- Loading skeletons — server-rendered, instant.
