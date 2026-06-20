"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  loadLibraryForPickerAction,
  pickFromLibraryAction,
} from "@/app/(app)/(onboarded)/schedule-posts/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LibraryImage } from "@/lib/schema";
import { cn } from "@/lib/utils";

const ACCEPT_MIME = "image/png,image/jpeg,image/webp";
const ACCEPT_LIST = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Two-tab dialog for replacing a post's image — either by uploading a
 * file from the device or picking from the user's library. Triggered
 * by the "Upload image" button on each `/schedule-posts` row.
 *
 * Upload path: posts `multipart/form-data` to
 * `/api/posts/[postId]/image/upload`. Server resizes to 1080×1080 JPEG
 * via sharp, uploads two independent blobs (post + library copy), and
 * retains the prior image to library before swapping.
 *
 * Library path: `pickFromLibraryAction` server action. References the
 * library blob URL directly (no copy); bumps `lastUsedAt` so cleanup
 * keeps the chosen image alive.
 */
export function UploadImageDialog({
  postId,
  open,
  onOpenChange,
}: {
  postId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"upload" | "library">("upload");

  // --- Upload tab state ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadPending, startUploadTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);

  // --- Library tab state ---
  const [libraryItems, setLibraryItems] = useState<LibraryImage[] | null>(
    null,
  );
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(
    null,
  );
  const [pickPending, startPickTransition] = useTransition();

  // Preview-URL lifecycle is managed entirely from event handlers (file
  // picker change + dialog close). React 19 / Next 16 lint guards
  // against setState-in-effect; event-driven is the recommended path
  // for "create an external resource and clean it up on action".

  function revokePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }

  function resetState() {
    revokePreview();
    setPreviewUrl(null);
    setSelectedFile(null);
    setUploadError(null);
    setSelectedLibraryId(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState();
    onOpenChange(next);
  }

  function pickFile(file: File | null) {
    // Always revoke the previous preview blob URL before replacing it.
    revokePreview();
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadError(null);
      return;
    }
    if (!ACCEPT_LIST.includes(file.type)) {
      setUploadError("Use a PNG, JPG, or WEBP file.");
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError("File is larger than 5 MB.");
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }
    setUploadError(null);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  // Lazy library load fires from the tab-switch handler (event-driven,
  // not effect-driven) so the lint rule is happy AND we don't pay the
  // round-trip until the user opts in.
  function handleTabSwitch(next: "upload" | "library") {
    setTab(next);
    if (
      next === "library" &&
      libraryItems === null &&
      !libraryLoading
    ) {
      setLibraryLoading(true);
      loadLibraryForPickerAction()
        .then((items) => setLibraryItems(items))
        .catch((err) => {
          console.error("[upload-image-dialog] library load failed", err);
          toast.error("Couldn't load your library.");
          setLibraryItems([]);
        })
        .finally(() => setLibraryLoading(false));
    }
  }

  function handleUpload() {
    if (!selectedFile) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.append("file", selectedFile);
      try {
        const response = await fetch(`/api/posts/${postId}/image/upload`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          setUploadError(uploadErrorCopy(response.status, body.error));
          return;
        }
        toast.success("Image uploaded.");
        handleOpenChange(false);
        router.refresh();
      } catch (err) {
        console.error("[upload-image-dialog] fetch failed", err);
        setUploadError("Something went wrong. Try again.");
      }
    });
  }

  function handlePickFromLibrary() {
    if (!selectedLibraryId) return;
    const libraryImageId = selectedLibraryId;
    startPickTransition(async () => {
      const result = await pickFromLibraryAction(postId, libraryImageId);
      if (!result.ok) {
        toast.error("Couldn't use this image.");
        return;
      }
      toast.success("Image updated.");
      handleOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            Replace image
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Upload a new image from your device or pick one from your
            library. Replaces the current image; the old one moves to
            your library.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Image source"
          className="flex gap-2 border-b border-border mt-2"
        >
          <TabButton
            active={tab === "upload"}
            onClick={() => handleTabSwitch("upload")}
          >
            Upload
          </TabButton>
          <TabButton
            active={tab === "library"}
            onClick={() => handleTabSwitch("library")}
          >
            From library
          </TabButton>
        </div>

        {tab === "upload" ? (
          <div className="space-y-4 pt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_MIME}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />

            {previewUrl ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Selected image preview"
                    className="w-full h-auto max-h-72 object-contain"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedFile?.name} ·{" "}
                  {Math.round((selectedFile?.size ?? 0) / 1024)} KB
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadPending}
                >
                  Choose a different file
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-2xl border-2 border-dashed border-border bg-muted/40 p-10 flex flex-col items-center gap-3 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                disabled={uploadPending}
              >
                <Upload
                  className="size-6"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="text-sm">Click to choose a file</span>
                <span className="text-xs">PNG, JPG, or WEBP · up to 5 MB</span>
              </button>
            )}

            {uploadError ? (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            ) : null}

            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={uploadPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleUpload}
                disabled={!selectedFile || uploadPending}
                className="rounded-full glow-champagne"
              >
                {uploadPending ? (
                  <>
                    <Loader2
                      className="animate-spin size-4 mr-2"
                      aria-hidden="true"
                    />
                    Uploading…
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            {libraryLoading || libraryItems === null ? (
              <div className="flex items-center justify-center py-12">
                <Loader2
                  className="animate-spin size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            ) : libraryItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                Your library is empty. Upload an image to start filling it.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-3 max-h-72 overflow-y-auto">
                {libraryItems.map((item) => {
                  const isSelected = item.id === selectedLibraryId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedLibraryId(item.id)}
                        className={cn(
                          "block w-full aspect-square rounded-lg overflow-hidden border-2 transition-colors",
                          isSelected
                            ? "border-primary"
                            : "border-transparent hover:border-border",
                        )}
                        aria-pressed={isSelected}
                      >
                        <Image
                          src={item.imageUrl}
                          alt=""
                          width={140}
                          height={140}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={pickPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handlePickFromLibrary}
                disabled={!selectedLibraryId || pickPending}
                className="rounded-full glow-champagne"
              >
                {pickPending ? (
                  <>
                    <Loader2
                      className="animate-spin size-4 mr-2"
                      aria-hidden="true"
                    />
                    Using…
                  </>
                ) : (
                  "Use this image"
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function uploadErrorCopy(
  status: number,
  errorCode: string | undefined,
): string {
  switch (errorCode) {
    case "too_large":
      return "File is larger than 5 MB.";
    case "bad_mime":
      return "Use a PNG, JPG, or WEBP file.";
    case "not_found":
      return "This post no longer exists.";
    case "not_owned":
      return "You don't have access to this post.";
    case "processing_failed":
      return "Couldn't process the image. Try a different one.";
    case "db_failed":
      return "Something went wrong saving the image. Try again.";
    case "unauthenticated":
      return "Please sign in again.";
  }
  if (status === 401) return "Please sign in again.";
  if (status === 413) return "File is larger than 5 MB.";
  if (status === 415) return "Use a PNG, JPG, or WEBP file.";
  return "Something went wrong. Try again.";
}
