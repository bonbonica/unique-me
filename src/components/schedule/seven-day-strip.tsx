"use client";

import { Check, X } from "lucide-react";

export type SevenDayStripDay = {
  label: string;
  date: Date;
  status: "scheduled" | "cancelled" | "posted";
};

type Props = { days: SevenDayStripDay[] };

export function SevenDayStrip({ days }: Props) {
  return (
    <div
      className="grid grid-cols-7 gap-3"
      role="list"
      aria-label="7-day post schedule"
    >
      {days.map((day, index) => {
        const fullDate = day.date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });

        return (
          <div
            key={index}
            role="listitem"
            className="flex flex-col items-center gap-1 text-center"
            aria-label={`${fullDate}: ${day.status}`}
          >
            <span className="text-xs text-muted-foreground tracking-wide uppercase">
              {day.label}
            </span>
            {renderGlyph(day.status)}
          </div>
        );
      })}
    </div>
  );
}

function renderGlyph(status: SevenDayStripDay["status"]) {
  if (status === "scheduled") {
    return (
      <Check
        className="size-4 text-primary"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }
  if (status === "cancelled") {
    return (
      <X
        className="size-4 text-destructive"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }
  // Phase-7 dormant: Stage-2 never produces "posted".
  return (
    <span
      className="block size-2 rounded-full bg-emerald-400/80"
      aria-hidden="true"
    />
  );
}
