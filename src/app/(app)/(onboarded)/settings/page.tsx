import { Sparkles } from "lucide-react";

/**
 * Phase 5 expands this into the 4-tab Settings page (profile, connected
 * accounts, subscription, notifications). Placeholder copy for Phase 1.
 */
export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary border border-primary/30 px-3 py-1 text-xs font-medium tracking-wider uppercase">
        <Sparkles className="size-3" />
        Coming soon
      </div>
      <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
        Settings
      </h1>
      <p className="text-lg text-muted-foreground leading-8">
        Profile, connected accounts, subscription, and notifications.
      </p>
    </div>
  );
}
