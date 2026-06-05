"use client";

import { useState } from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryImage } from "@/lib/schema";
import { LibraryImageDeleteDialog } from "./library-image-delete-dialog";

type Props = {
  images: LibraryImage[];
};

/**
 * Responsive grid of `library_images` rows (spec §6.12 / D-S2-18). Owns the
 * delete-target state for the per-tile destructive flow — the dialog itself
 * is rendered once at the bottom and driven by `target`. Newest-first order
 * is set by `imageService.listLibrary`; this component does no sorting.
 *
 * Tile anatomy:
 *  - `aspect-square overflow-hidden rounded-2xl` per DESIGN.md §6 (signature
 *    card radius) and spec §6.12 (1:1 tiles).
 *  - Hover-lift via DESIGN.md §11 `card-interactive` pattern.
 *  - `next/image` `fill` + `sizes` — parent `relative` satisfies the layout
 *    requirement.
 *  - `[Delete]` overlay revealed on `group-hover` AND `focus-within` so
 *    keyboard users can reach it via Tab without a hover gesture.
 */
export function LibraryGrid({ images }: Props) {
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
                <Trash2 className="size-4" aria-hidden />
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {target && (
        <LibraryImageDeleteDialog
          libraryImageId={target.id}
          open={!!target}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
        />
      )}
    </>
  );
}
