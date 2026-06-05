"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Props = { scheduledBatchCount: number };

const CAP = 4;

export function CreateNextBatchCta({ scheduledBatchCount }: Props) {
  const atCap = scheduledBatchCount >= CAP;
  const label = `Create next batch — ${scheduledBatchCount}/${CAP}`;

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
