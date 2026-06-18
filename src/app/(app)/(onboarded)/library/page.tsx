import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LibraryActions } from "@/components/library/library-actions";
import { LibraryGrid } from "@/components/library/library-grid";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";
import { LIBRARY_CAP } from "@/lib/services/image-service";

/**
 * Stage-2 functional Image Library (D-S2-18), extended in Wave 3 Stage 4
 * with the per-tile padlock affordance + header Download all / Delete all
 * buttons. Server component fetches `library_images` newest-first via
 * `imageService.listLibrary` and renders a responsive grid.
 *
 * Cap is `LIBRARY_CAP` (100) — count pill shows `{count}/{LIBRARY_CAP}`.
 * Enforcement lives in `runMonthlyCleanup` (Wave 3), not at the write
 * path; the library can briefly exceed 100 between cleanups.
 *
 * Layout follows DESIGN.md §8 pattern B (editorial content) with `max-w-5xl`
 * instead of the default `max-w-3xl` so the 4-column grid at `lg:` has room
 * to breathe per spec §6.12.
 *
 * Inputs: `deleteBatchForever` populates `library_images` (D-S2-8); the
 * reserved future `deletePost` (D-S2-22) will be the second input when it
 * ships. Per-post `cancelPost` does NOT feed the Library — non-destructive
 * (§0 Cancel-vs-Delete contract).
 */
export default async function LibraryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const images = await imageService.listLibrary(session.user.id);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
            Your image library
          </h1>
          <p className="text-sm text-muted-foreground">
            {images.length}/{LIBRARY_CAP} images
          </p>
        </div>
        <LibraryActions hasImages={images.length > 0} />
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
