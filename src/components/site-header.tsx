import Image from "next/image";
import Link from "next/link";
import { UserProfile } from "@/components/auth/user-profile";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <>
      {/* Skip to main content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:rounded-md"
      >
        Skip to main content
      </a>
      <header className="border-b" role="banner">
        <nav
          className="container mx-auto px-3 sm:px-4 py-3 sm:py-4 flex justify-between items-center"
          aria-label="Main navigation"
        >
          {/*
            Wordmark per DESIGN.md § 14. Two parts:
              1. The icon inside the gradient circle — the user-supplied
                 vector at public/uniqueme-logo.svg. Same file the user
                 uploaded, just with the viewBox tightened to crop out the
                 portrait-canvas whitespace (artwork was sitting in roughly
                 the upper-middle of a 1024x1536 canvas).
              2. The gilt-text "UniqueMe" wordmark in Fraunces, using the
                 .gilt utility for the per-theme gold gradient.
            The SVG carries its own hardcoded gold gradients, so it does
            NOT inherit text-primary — the icon stays the designed gold
            in both light and dark modes by design.
          */}
          <h1 className="text-xl sm:text-2xl">
            <Link
              href="/"
              className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
              aria-label="UniqueMe - Go to homepage"
            >
              <div
                className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-accent/10 border border-primary/30 flex items-center justify-center"
                aria-hidden="true"
              >
                <Image
                  src="/uniqueme-logo.svg"
                  alt=""
                  width={540}
                  height={540}
                  className="size-7 translate-x-0.5"
                  priority
                />
              </div>
              <span className="font-fraunces font-medium tracking-tight gilt">
                UniqueMe
              </span>
            </Link>
          </h1>
          <div className="flex items-center gap-2 sm:gap-4" role="group" aria-label="User actions">
            {/*
              ThemeToggle ships globally — visible on every route, signed in
              or not. Placed before UserProfile so the avatar stays the
              right-most affordance.
            */}
            <ThemeToggle />
            <UserProfile />
          </div>
        </nav>
      </header>
    </>
  );
}
