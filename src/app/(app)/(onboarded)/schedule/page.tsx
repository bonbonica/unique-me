import { Sparkles } from "lucide-react";

/**
 * Phase 4 ships the Schedule page (weekly calendar + auto-schedule logic).
 * Placeholder for Phase 1.
 */
export default function SchedulePage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-medium tracking-wider uppercase">
        <Sparkles className="size-3" />
        Coming soon
      </div>
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Schedule
      </h1>
      <p className="text-lg text-muted-foreground leading-8">
        Your weekly calendar of scheduled posts.
      </p>
    </div>
  );
}
