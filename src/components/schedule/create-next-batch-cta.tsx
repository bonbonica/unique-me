"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = {
  /**
   * Count of ALL `weekly_batches` rows for the user in the current Pro
   * period (any status). Mirrors `canGenerate`'s server cap (D-A16) so the
   * CTA can never advertise a slot the cap won't honour.
   */
  proBatchesUsed: number;
};

const CAP = 4;

export function CreateNextBatchCta({ proBatchesUsed }: Props) {
  const atCap = proBatchesUsed >= CAP;
  const label = `Create next batch — ${proBatchesUsed}/${CAP}`;

  if (!atCap) {
    return (
      <Button
        asChild
        variant="default"
        size="lg"
        className="w-full md:max-w-xs"
      >
        <Link href="/create">{label}</Link>
      </Button>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        {/* The <span> wrapper is required: a disabled <button> swallows pointer
            events, which would prevent the tooltip from ever opening. */}
        <TooltipTrigger asChild>
          <span className="inline-block w-full md:max-w-xs">
            <Button
              variant="default"
              size="lg"
              disabled
              aria-disabled="true"
              className="w-full"
            >
              {label}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Schedule a new batch by cancelling or finishing one.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
