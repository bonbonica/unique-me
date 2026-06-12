"use client";

import { useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { deleteBatchForeverAction } from "@/app/(app)/(onboarded)/create/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Tier-aware confirmation context for the delete-forever dialog
 * (specs/delete-warning/spec.md §3). The page derives this once per render
 * from `subscriptionService.checkSubscription` and threads it down through
 * the list → card → trigger → dialog. The dialog picks copy and primary
 * CTA from `tier`; the Starter branch additionally branches on
 * `nextAvailable === null` to render the neutral copy (no date claim).
 *
 * `nextAvailable: Date | null` on the starter variant is load-bearing.
 * A null value means "we don't know the next-available date" — the dialog
 * must render the neutral Starter copy instead of fabricating a placeholder
 * date. See spec §3 "Why nullable instead of a sentinel".
 */
export type DeleteWarning =
  | { tier: "trial" }
  | { tier: "starter"; nextAvailable: Date | null }
  | { tier: "pro_under_cap"; remaining: number }
  | { tier: "pro_at_cap"; nextAvailable: Date };

type Props = {
  batchId: string;
  imageCount: number;
  warning: DeleteWarning;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Confirm dialog for hard-deleting a cancelled batch. Tier-aware warning
 * copy fronts the destructive action with the user's real next-available
 * date (or remaining count for Pro under-cap). Buttons offer the easy path
 * (Edit posts → /posts?batchId=...) and the destructive path (Delete anyway).
 *
 * Trial replaces "Edit posts" with "Upgrade →" — there's no point editing
 * a trial batch the user already cancelled if they can't generate again on
 * trial (spec §2).
 *
 * Date rendering uses the local browser timezone via `Intl.DateTimeFormat`,
 * gated behind a mount sentinel so SSR + first-client renders produce
 * identical markup. Same pattern `<QuotaGatedScreen />` uses — the
 * `useHasMounted` hook is copied verbatim per spec §7 (no new hook).
 *
 * The success-toast and error-toast paths are unchanged from the prior
 * iteration. The wire is still `deleteBatchForeverAction(batchId)` →
 * `postService.deleteBatchForever`.
 */
export function DeleteBatchForeverDialog({
  batchId,
  imageCount,
  warning,
  open,
  onOpenChange,
}: Props) {
  const [pending, startTransition] = useTransition();
  const mounted = useHasMounted();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteBatchForeverAction(batchId);
      if (!result.ok) {
        toast.error(
          result.error === "not_found"
            ? "This batch was already removed."
            : "Couldn't delete this batch.",
        );
        onOpenChange(false);
        return;
      }
      toast.success(
        `Batch deleted. ${imageCount} ${
          imageCount === 1 ? "image" : "images"
        } saved to your Library.`,
      );
      onOpenChange(false);
    });
  }

  const title =
    warning.tier === "trial" ? "Delete your trial batch?" : "Delete this batch?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-fraunces text-2xl tracking-tight font-medium">
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <WarningLine warning={warning} mounted={mounted} />
          <DialogDescription className="text-base text-muted-foreground leading-7">
            <SolutionCopy tier={warning.tier} />
          </DialogDescription>
          <p className="text-sm text-muted-foreground">
            {imageCount} {imageCount === 1 ? "image" : "images"} will move to
            your Image Library.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete anyway"}
          </Button>
          <PrimaryAction warning={warning} batchId={batchId} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Render the destructive warning sentence with an inline `AlertCircle`
 * icon. Per DESIGN.md §3 the destructive token is warm coral (not
 * saturated red); per §10 Lucide icons render at `strokeWidth={1.5}`.
 *
 * Date rendering: when the user is mounted, format via the browser's
 * locale `Intl.DateTimeFormat`. Before mount, render the generic "soon"
 * fallback so SSR + first client pass match exactly (same pattern as
 * `<QuotaVariant />`). The starter / null-date branch never renders a
 * date at all — neutral copy per spec §2.
 */
function WarningLine({
  warning,
  mounted,
}: {
  warning: DeleteWarning;
  mounted: boolean;
}) {
  return (
    <p className="flex items-start gap-2 text-base text-destructive leading-7">
      <AlertCircle
        className="size-5 shrink-0 mt-0.5"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span>
        <WarningCopy warning={warning} mounted={mounted} />
      </span>
    </p>
  );
}

function WarningCopy({
  warning,
  mounted,
}: {
  warning: DeleteWarning;
  mounted: boolean;
}) {
  switch (warning.tier) {
    case "trial":
      return (
        <>
          Alert — this is your trial batch. Deleting it won&apos;t let you make
          another.
        </>
      );

    case "starter": {
      // Null-date neutral path per spec §2. Renders a single sentence with
      // no fabricated date. Used for inactive paid plans and the rare
      // Starter-with-no-prior-batch case.
      if (warning.nextAvailable === null) {
        return <>Alert — deleting won&apos;t free up a new batch.</>;
      }
      const dateLabel = mounted
        ? formatLongDate(warning.nextAvailable)
        : "soon";
      return (
        <>
          Alert — deleting won&apos;t free up a new batch. Your next one unlocks
          on {dateLabel} (7 days from creation).
        </>
      );
    }

    case "pro_under_cap":
      return (
        <>
          Alert — deleting won&apos;t give you the slot back. You&apos;ll have{" "}
          {warning.remaining} of 4 batches left this period.
        </>
      );

    case "pro_at_cap": {
      const dateLabel = mounted
        ? formatLongDate(warning.nextAvailable)
        : "soon";
      return (
        <>
          Alert — you&apos;ve used all 4 batches this period. Deleting
          won&apos;t free up a new one — you won&apos;t be able to create
          another until {dateLabel}.
        </>
      );
    }
  }
}

/**
 * Solution sentence — the "instead, edit / upgrade" line. Trial leads with
 * upgrade copy. The Pro at-cap variant intentionally drops the
 * "keep your full set" tail (spec §2) — reads odd next to "you've used all 4".
 */
function SolutionCopy({ tier }: { tier: DeleteWarning["tier"] }) {
  switch (tier) {
    case "trial":
      return <>Upgrade to keep creating posts.</>;
    case "pro_at_cap":
      return <>Instead, you can edit the posts.</>;
    case "starter":
    case "pro_under_cap":
      return <>Instead, you can edit the posts and keep your full set.</>;
  }
}

/**
 * Primary CTA. Trial → Upgrade → /pricing. Everyone else → Edit posts →
 * /posts?batchId=... (the existing cancelled-recoverable wizard). Both use
 * `asChild` so the champagne pill becomes a `<Link>` for client navigation.
 */
function PrimaryAction({
  warning,
  batchId,
}: {
  warning: DeleteWarning;
  batchId: string;
}) {
  if (warning.tier === "trial") {
    return (
      <Button asChild>
        <Link href="/pricing">
          Upgrade
          <ArrowRight
            className="ml-1 size-4"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </Link>
      </Button>
    );
  }
  return (
    <Button asChild>
      <Link href={`/posts?batchId=${batchId}`}>
        Edit posts
        <ArrowRight
          className="ml-1 size-4"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </Link>
    </Button>
  );
}

/**
 * Mount sentinel — false during SSR + first client render, true thereafter.
 * Copied verbatim from `<QuotaGatedScreen />`'s implementation
 * (`quota-gated-screen.tsx:90–96`) per spec §7. Keeps the SSR/CSR markup
 * identical for hydration, then flips so the real locale-formatted date
 * can render.
 */
function useHasMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}
