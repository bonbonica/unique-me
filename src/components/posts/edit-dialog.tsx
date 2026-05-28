"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3, Loader2 } from "lucide-react";
import { updatePostAction } from "@/app/(app)/(onboarded)/posts/actions";
import type { Post } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Per-post Edit dialog (Phase 2 task-12). Lets the user replace the
 * canonical Facebook caption + hashtags without an AI call. Variations
 * stay stale on purpose; the wizard step's R12 inline note (Wave 5)
 * tells the user when an IG/LinkedIn version is older than the
 * canonical.
 *
 * Save calls {@link updatePostAction}; on success the dialog closes and
 * the page is refreshed so the wizard re-renders with the new text.
 *
 * Hashtags are accepted as a comma-separated string. The user shouldn't
 * type `#` — we strip leading `#` and trim whitespace as a kindness.
 */
export function EditDialog({ post }: { post: Post }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [postText, setPostText] = useState(post.postText);
  const [hashtagsRaw, setHashtagsRaw] = useState(post.hashtags.join(", "));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSubmitting(true);
    setError(null);

    const hashtags = hashtagsRaw
      .split(",")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter((s) => s.length > 0);

    const result = await updatePostAction(post.id, {
      postText: postText.trim(),
      hashtags,
    });

    if (result.ok) {
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } else {
      setError(editErrorCopy(result.error));
      setSubmitting(false);
    }
  }

  // Reset local state to the persisted values whenever the dialog is
  // closed without saving. Otherwise a user who cancels would see their
  // half-typed draft if they reopened the dialog.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPostText(post.postText);
      setHashtagsRaw(post.hashtags.join(", "));
      setError(null);
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Edit3 className="size-4" aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Post {post.postOrder}</DialogTitle>
          <DialogDescription>
            Edits apply to the Facebook version. Instagram and LinkedIn
            versions may be older after you save — regenerate to refresh
            them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor={`post-text-${post.id}`}>Post text</Label>
            <Textarea
              id={`post-text-${post.id}`}
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              rows={6}
              className="mt-2 bg-muted"
            />
          </div>
          <div>
            <Label htmlFor={`hashtags-${post.id}`}>
              Hashtags (comma-separated)
            </Label>
            <Input
              id={`hashtags-${post.id}`}
              value={hashtagsRaw}
              onChange={(e) => setHashtagsRaw(e.target.value)}
              placeholder="protein, nutrition, smallbusiness"
              className="mt-2 h-11 bg-muted"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Don&apos;t include the #.
            </p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={submitting || postText.trim().length === 0}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin size-4 mr-2" aria-hidden />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function editErrorCopy(err: string): string {
  switch (err) {
    case "batch_locked":
      return "This batch is locked — you can't edit it anymore.";
    case "not_owned":
      return "You don't have access to this post.";
    case "not_found":
      return "Post not found.";
    case "db_failed":
      return "Couldn't save changes. Try again.";
    default:
      return "Something went wrong.";
  }
}
