import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { profileService } from "@/lib/services";

/**
 * Onboarding success screen (Phase 1, spec § 1.4).
 *
 * Reached via `router.replace("/onboarding/done")` from the form after
 * `saveOnboardingAction` succeeds. We re-validate session + profile here so
 * a direct visit can't bypass the gate — and because the proxy's cookie
 * check is intentionally optimistic, the DB read is the real source of
 * truth. Layout follows DESIGN.md Pattern D (focal task) with a single
 * centered moment of branded copy.
 */

export default async function OnboardingDonePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const has = await profileService.hasProfile(session.user.id);
  if (!has) {
    redirect("/onboarding");
  }

  return (
    <div className="auth-bg min-h-[calc(100vh-4rem)] flex items-center justify-center px-5 sm:px-8 py-12 sm:py-16 lg:py-24">
      <div className="w-full max-w-2xl text-center space-y-8">
        <div className="size-16 mx-auto rounded-2xl bg-gradient-to-br from-primary/30 to-accent/10 border border-primary/30 flex items-center justify-center">
          <Sparkles className="size-7 text-primary" aria-hidden="true" />
        </div>
        <h1 className="font-fraunces text-4xl sm:text-5xl tracking-tight font-medium">
          <span className="gilt">You&apos;re all set.</span>
        </h1>
        <p className="text-lg text-muted-foreground leading-8 max-w-md mx-auto">
          Your business profile is saved. Let&apos;s create your first week of
          posts.
        </p>
        <Button
          asChild
          size="lg"
          className="rounded-full glow-champagne mt-4"
        >
          <Link href="/dashboard">Create My First Posts</Link>
        </Button>
      </div>
    </div>
  );
}
