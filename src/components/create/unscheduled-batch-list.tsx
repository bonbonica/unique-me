import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UnscheduledBatchCard as CardData } from "@/lib/services/post-service";
import { UnscheduledBatchCard } from "./unscheduled-batch-card";
import type { DeleteWarning } from "./delete-batch-forever-dialog";

/**
 * Server component that sits above `<GenerateForm />` / the gated screens on
 * `/create`. Renders the two top buttons (`[Start new batch]`,
 * `[See scheduled posts →]`), an optional `belowButtonsSlot` (the
 * conditionally-expanded generate form, or a gated screen), and stacks
 * each unscheduled-batch card.
 *
 * Per spec §2 + task-07, the Create page owns the form-toggle interaction and
 * injects its own `[Start new batch]` control via {@link Props.startNewBatchSlot}
 * — the list itself stays purely server-rendered. When no slot is provided
 * (e.g. on the at-cap path), this component renders a disabled default button
 * with a native `title` tooltip explaining the capacity gate.
 *
 * **`belowButtonsSlot` placement.** Renders directly under the buttons row
 * and ABOVE the cards. When the user hits `[Start new batch]`, the form
 * expands here — adjacent to the button that triggered it, above any
 * existing batches (reviewing or cancelled). Earlier revisions rendered the
 * form below the cards; that put it underneath cancelled batches and made
 * the action feel buried. Gated screens take the same slot for the same
 * structural reason — the message about WHY the user can't create new posts
 * belongs next to the disabled button, not below their existing batches.
 *
 * Empty-state contract (D-S14): when there are zero cards AND no slot is
 * injected, the entire section renders `null`. That lets fresh-state users see
 * the form take the full frame without an empty top stripe of buttons. The
 * `belowButtonsSlot` is the caller's responsibility to render in that case —
 * see `<CreatePage />`.
 */
type Props = {
  cards: CardData[];
  startNewBatchSlot?: React.ReactNode;
  belowButtonsSlot?: React.ReactNode;
  hasCapacity: boolean;
  capacityTooltip?: string;
  warning: DeleteWarning;
};

export function UnscheduledBatchList({
  cards,
  startNewBatchSlot,
  belowButtonsSlot,
  hasCapacity,
  capacityTooltip,
  warning,
}: Props) {
  // Hide the whole section on fresh-state users (no cards + page didn't inject
  // a custom button). The caller is responsible for rendering the form / gate
  // in that path so it can take the full frame without our buttons row chrome.
  if (cards.length === 0 && !startNewBatchSlot) return null;

  return (
    <section className="space-y-6" aria-label="Unscheduled batches">
      <div className="flex flex-wrap items-center gap-3">
        {startNewBatchSlot ?? (
          <Button
            disabled={!hasCapacity}
            title={!hasCapacity ? capacityTooltip : undefined}
          >
            Start new batch
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/schedule">
            See scheduled posts
            <ArrowRight
              className="ml-1 size-4"
              strokeWidth={1.5}
              aria-hidden
            />
          </Link>
        </Button>
      </div>

      {belowButtonsSlot}

      {cards.length > 0 && (
        <div className="space-y-4">
          {cards.map((card) => (
            <UnscheduledBatchCard
              key={card.id}
              data={card}
              warning={warning}
            />
          ))}
        </div>
      )}
    </section>
  );
}
