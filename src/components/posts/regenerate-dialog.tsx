"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { regeneratePostAction } from "@/app/(app)/(onboarded)/posts/actions";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Per-post Regenerate dialog (Phase 2 task-12). Submits the user's
 * free-text feedback to {@link regeneratePostAction}, which calls
 * `postGenerator.regenerateOne` and (on success) rewrites the canonical
 * post + replaces its IG/LinkedIn variations atomically.
 *
 * Hard 1× cap (D11) is enforced two ways:
 *   - Server-side, inside `postService.regenerate`, before the AI call.
 *   - Client-side, here: when `disabled` is true the trigger renders as a
 *     disabled button (no Dialog opens) with a tooltip. The caller
 *     ({@link WizardStep}) computes `disabled = post.regenerationCount >= 1`.
 *
 * The "you can only regenerate each post once" warning lives in the
 * dialog's description so the user knows BEFORE they spend their one shot.
 */
export function RegenerateDialog({
  post,
  disabled,
  disabledTooltip,
}: {
  post: Post;
  disabled: boolean;
  disabledTooltip?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (feedback.trim().length === 0) {
      setError("Tell us what you'd like different.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await regeneratePostAction(post.id, feedback.trim());

    if (result.ok) {
      setOpen(false);
      setFeedback("");
      setSubmitting(false);
      router.refresh();
    } else {
      setError(regenErrorCopy(result.error));
      setSubmitting(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setFeedback("");
      setError(null);
    }
    setOpen(next);
  }

  if (disabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-2"
        disabled
        title={disabledTooltip}
        aria-label={disabledTooltip}
      >
        <RefreshCw className="size-4" aria-hidden />
        Regenerate
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <RefreshCw className="size-4" aria-hidden />
          Regenerate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate Post {post.postOrder}</DialogTitle>
          <DialogDescription>
            Tell us what should be different. We&apos;ll rewrite this post —
            Facebook caption plus Instagram and LinkedIn variations — in one
            go. <strong>You can only regenerate each post once.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`feedback-${post.id}`}>
            What should be different?
          </Label>
          <Textarea
            id={`feedback-${post.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            placeholder="e.g. make it warmer, shorter, less salesy; drop the question at the end; lead with the recipe…"
            className="mt-2 bg-muted"
          />
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
            onClick={handleSubmit}
            disabled={submitting || feedback.trim().length === 0}
          >
            {submitting ? (
              <>
                <Loader2 className="animate-spin size-4 mr-2" aria-hidden />
                Regenerating…
              </>
            ) : (
              "Regenerate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function regenErrorCopy(err: string): string {
  switch (err) {
    case "regeneration_limit_reached":
      return "You've already regenerated this post — only one rewrite per post.";
    case "batch_locked":
      return "This batch is locked — you can't regenerate anymore.";
    case "ai_failed":
      return "Couldn't reach the AI service. Try again in a minute.";
    case "not_owned":
      return "You don't have access to this post.";
    case "not_found":
      return "Post not found.";
    case "db_failed":
      return "Couldn't save the regenerated post. Try again.";
    default:
      return "Something went wrong.";
  }
}
