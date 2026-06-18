"use client";

import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteAllConfirmationDialog } from "./delete-all-confirmation-dialog";
import { DownloadCleanupPromptDialog } from "./download-cleanup-prompt-dialog";

type Props = {
  hasImages: boolean;
};

/**
 * Header action buttons for the library page (Wave 3 Stage 4). Client
 * component so the dialog open state stays local. The server page passes
 * `hasImages` so both buttons disable when the library is empty.
 *
 * Download flow:
 *  1. Synthesise an `<a download href="/api/library/download">` and click
 *     it — preserves the user-gesture trust the browser needs to surface
 *     its Save dialog.
 *  2. Open the post-download popup so the user can optionally clear the
 *     library now that they have copies on their device.
 */
export function LibraryActions({ hasImages }: Props) {
  const [downloadPromptOpen, setDownloadPromptOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  function handleDownload() {
    const a = document.createElement("a");
    a.href = "/api/library/download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setDownloadPromptOpen(true);
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={handleDownload}
          disabled={!hasImages}
        >
          <Download className="size-4" strokeWidth={1.5} aria-hidden />
          Download all
        </Button>
        <Button
          variant="outline"
          onClick={() => setDeleteAllOpen(true)}
          disabled={!hasImages}
        >
          <Trash2
            className="size-4 text-destructive"
            strokeWidth={1.5}
            aria-hidden
          />
          Delete all
        </Button>
      </div>

      <DownloadCleanupPromptDialog
        open={downloadPromptOpen}
        onOpenChange={setDownloadPromptOpen}
      />
      <DeleteAllConfirmationDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
      />
    </>
  );
}
