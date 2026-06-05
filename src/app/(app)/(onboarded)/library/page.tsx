import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LibraryGrid } from "@/components/library/library-grid";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";

/**
 * Stage-2 functional Image Library (D-S2-18). Server component that fetches
 * `library_images` newest-first via `imageService.listLibrary` and renders a
 * responsive grid capped at 30 (cap enforced at the write path —
 * `imageService.retainImagesToLibrary` — not here).
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content) with `max-w-5xl`
 * instead of the default `max-w-3xl` so the 4-column grid at `lg:` has room
 * to breathe per spec §6.12.
 *
 * Inputs at Stage-2 land: only `deleteBatchForever` populates `library_images`
 * (D-S2-8). Per-post `cancelPost` does NOT feed the Library — it's
 * non-destructive (§0 Cancel-vs-Delete contract). The reserved future
 * `deletePost` (D-S2-22) will be the second input when it ships. Most users
 * will see the empty state for a while; the copy is written so that reads as
 * design intent rather than a bug.
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
