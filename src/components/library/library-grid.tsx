"use client";

import { useState } from "react";
import Image from "next/image";
import { Lock, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";
import { toggleLibraryImageLockAction } from "@/app/(app)/(onboarded)/library/actions";
import { Button } from "@/components/ui/button";
import type { LibraryImage } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { LibraryImageDeleteDialog } from "./library-image-delete-dialog";

type Props = {
  images: LibraryImage[];
};

/**
 * Responsive grid of `library_images` rows. Owns:
 *  - `target` for the per-tile delete dialog (rendered once at the bottom).
 *  - `lockOverrides` for optimistic padlock toggles (Wave 3 Stage 4).
 *
 * Optimistic lock model: clicking the padlock flips the icon synchronously
 * via a Map<id, boolean> override, then awaits the server action. On
 * failure the override is deleted (display reverts to the prop value). On
 * success the override stays — once revalidatePath delivers fresh props,
 * the override and the prop agree (both say locked / both say unlocked),
 * so there's no flicker. The override Map grows by one entry per toggled
 * tile per session, bounded by the visible image count.
 *
 * Tile anatomy:
 *  - `aspect-square overflow-hidden rounded-2xl` per DESIGN.md §6.
 *  - Hover-lift via DESIGN.md §11 `card-interactive` pattern.
 *  - Padlock affordance (top-left): solid `bg-primary/15 border-primary/30`
 *    pill when locked, ghost `text-muted-foreground/70` icon when unlocked.
 *  - Last-used / Added timestamp badge (bottom-left).
 *  - Hover/focus-within delete overlay (bottom).
 */
export function LibraryGrid({ images }: Props) {
  const [target, setTarget] = useState<LibraryImage | null>(null);
  const [lockOverrides, setLockOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  function isLocked(img: LibraryImage): boolean {
    const override = lockOverrides.get(img.id);
    if (override !== undefined) return override;
    return img.lockedAt !== null;
  }

  async function handleToggleLock(img: LibraryImage) {
    const willLock = !isLocked(img);

    setLockOverrides((prev) => {
      const next = new Map(prev);
      next.set(img.id, willLock);
      return next;
    });

    const result = await toggleLibraryImageLockAction(img.id, willLock);
    if (!result.ok) {
      setLockOverrides((prev) => {
        const next = new Map(prev);
        next.delete(img.id);
        return next;
      });
      toast.error(
        result.error === "not_found"
          ? "Image was removed."
          : "Couldn't update lock state.",
      );
    }
    // Success path: leave the override in place. When `revalidatePath`
    // inside the action delivers fresh props, the prop's lockedAt agrees
    // with the override, so the displayed state is correct either way.
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {images.map((img) => {
          const locked = isLocked(img);
          return (
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

              <button
                type="button"
                onClick={() => handleToggleLock(img)}
                className={cn(
                  "absolute top-3 left-3 inline-flex items-center justify-center rounded-md p-1.5 transition-colors",
                  locked
                    ? "bg-primary/15 border border-primary/30 text-primary"
                    : "text-muted-foreground/70 hover:text-foreground",
                )}
                aria-label={locked ? "Unlock image" : "Lock image"}
                aria-pressed={locked}
              >
                {locked ? (
                  <Lock className="size-4" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Unlock className="size-4" strokeWidth={1.5} aria-hidden />
                )}
              </button>

              <p className="absolute bottom-2 left-2 text-xs text-white/80 drop-shadow">
                {img.lastUsedAt
                  ? `Used ${relativeTime(img.lastUsedAt)}`
                  : `Added ${relativeTime(img.createdAt)}`}
              </p>

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
          );
        })}
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

/**
 * Tiny relative-time formatter — "5m ago", "3h ago", "2d ago", "1w ago",
 * then "Jan 5" for anything older than 4 weeks. Compares against the
 * client clock; one-off skew never matters for "Added 3d ago".
 */
function relativeTime(date: Date | string): string {
  const t = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - t.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
