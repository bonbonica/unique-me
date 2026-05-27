import { Sparkles } from "lucide-react";

/**
 * Phase 3 swaps this for the real Image Library page (filter, select,
 * auto-cleanup, etc.). Placeholder keeps the sidebar route valid.
 */
export default function LibraryPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-medium tracking-wider uppercase">
        <Sparkles className="size-3" />
        Coming soon
      </div>
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Image library
      </h1>
      <p className="text-lg text-muted-foreground leading-8">
        Every image we&apos;ve made or you&apos;ve uploaded, in one place.
      </p>
    </div>
  );
}
