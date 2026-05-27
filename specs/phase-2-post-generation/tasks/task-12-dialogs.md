# Task 12: Dialogs — EditDialog + RegenerateDialog

## Status
not started

## Wave
4

## Description

Build the two dialog components used by `<WizardStep>`. `<EditDialog>` lets the user edit a post's canonical text + hashtags (no AI call). `<RegenerateDialog>` lets the user enter feedback and trigger `postService.regenerate` (AI call, 1× cap enforced).

## Dependencies

**Depends on:** task-04 (`update`, `regenerate` service methods)
**Blocks:** task-09 (wizard step imports both dialogs)
**Context from dependencies:** Server actions `updatePostAction(postId, updates)` and `regeneratePostAction(postId, feedback)` exist in `posts/actions.ts`.

## Files to Create

- `src/components/posts/edit-dialog.tsx` — NEW
- `src/components/posts/regenerate-dialog.tsx` — NEW

## Implementation Steps

### 1. `<EditDialog post={...} />`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/schema";
import { updatePostAction } from "@/app/(app)/(onboarded)/posts/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit3 } from "lucide-react";

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

    const result = await updatePostAction(post.id, { postText: postText.trim(), hashtags });

    if (result.ok) {
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } else {
      setError(editErrorCopy(result.error));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Edit3 className="size-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Post {post.postOrder}</DialogTitle>
          <DialogDescription>
            Edits apply to the Facebook version. Instagram and LinkedIn versions may be older after you save — regenerate to refresh them.
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
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor={`hashtags-${post.id}`}>Hashtags (comma-separated)</Label>
            <Input
              id={`hashtags-${post.id}`}
              value={hashtagsRaw}
              onChange={(e) => setHashtagsRaw(e.target.value)}
              placeholder="protein, nutrition, smallbusiness"
              className="mt-2"
            />
            <p className="text-xs text-muted-foreground mt-1">Don&apos;t include the #.</p>
          </div>
        </div>

        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting || postText.trim().length === 0}>
            {submitting ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function editErrorCopy(err: string): string {
  switch (err) {
    case "batch_locked":      return "This batch is locked — you can't edit it anymore.";
    case "not_owned":         return "You don't have access to this post.";
    case "not_found":         return "Post not found.";
    case "db_failed":         return "Couldn't save changes. Try again.";
    default:                  return "Something went wrong.";
  }
}
```

### 2. `<RegenerateDialog post={...} disabled={...} disabledTooltip={...} />`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Post } from "@/lib/schema";
import { regeneratePostAction } from "@/app/(app)/(onboarded)/posts/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RefreshCw } from "lucide-react";

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
        <RefreshCw className="size-4" />
        Regenerate
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <RefreshCw className="size-4" />
          Regenerate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regenerate Post {post.postOrder}</DialogTitle>
          <DialogDescription>
            Tell us what should be different. We&apos;ll rewrite this post — Facebook caption plus Instagram and LinkedIn variations — in one go. <strong>You can only regenerate each post once.</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`feedback-${post.id}`}>What should be different?</Label>
          <Textarea
            id={`feedback-${post.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            placeholder="e.g. make it warmer, shorter, less salesy; drop the question at the end; lead with the recipe..."
            className="mt-2"
          />
        </div>

        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || feedback.trim().length === 0}>
            {submitting ? "Regenerating..." : "Regenerate"}
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
    case "batch_locked":          return "This batch is locked — you can't regenerate anymore.";
    case "ai_failed":             return "Couldn't reach the AI service. Try again in a minute.";
    case "not_owned":             return "You don't have access to this post.";
    case "not_found":             return "Post not found.";
    case "db_failed":             return "Couldn't save the regenerated post. Try again.";
    default:                      return "Something went wrong.";
  }
}
```

## Acceptance Criteria

- [ ] `<EditDialog>` opens with current `postText` + `hashtags` pre-filled
- [ ] Save button calls `updatePostAction` → on success closes dialog + `router.refresh()`
- [ ] Save button disabled when `postText` is empty
- [ ] Hashtag input parses comma-separated values, strips leading `#`, trims whitespace
- [ ] `<RegenerateDialog>` with `disabled=true` renders a disabled button with the tooltip — no Dialog opens
- [ ] `<RegenerateDialog>` with `disabled=false` opens the feedback textarea
- [ ] Regenerate submit requires non-empty feedback
- [ ] On success: closes dialog, resets feedback, `router.refresh()`
- [ ] Error mapping for both dialogs covers all service-layer error values
- [ ] `npm run lint`, `npm run typecheck` clean

## Notes

- After `router.refresh()`, the server re-renders the page with the updated post — the `<WizardStep>` re-renders with the new content automatically. No local state to manage.
- The "you can only regenerate once" message in `<RegenerateDialog>`'s description is important — set expectations BEFORE the user uses their one shot.
- Both dialogs use `<Dialog>` from `src/components/ui/dialog.tsx` which is already installed.
