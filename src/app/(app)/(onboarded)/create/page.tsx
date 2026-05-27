import { Sparkles } from "lucide-react";

/**
 * Phase 2 will replace this with the real Create Posts flow: a 2-question
 * prompt that drives Anthropic-backed post generation. For Phase 1 we ship a
 * "Coming soon" stub so the sidebar link doesn't 404.
 */
export default function CreatePage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-medium tracking-wider uppercase">
        <Sparkles className="size-3" />
        Coming soon
      </div>
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Create this week&apos;s posts
      </h1>
      <p className="text-lg text-muted-foreground leading-8">
        Tell us your theme. We&apos;ll handle the rest.
      </p>
    </div>
  );
}
