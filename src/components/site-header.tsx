import Link from "next/link";
import { Bot } from "lucide-react";
import { UserProfile } from "@/components/auth/user-profile";

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
            Wordmark per DESIGN.md § 14. The Fraunces medium weight carries the
            visual heft, so the outer heading drops font-bold; the gilt
            gradient and tracking-tight come straight from the spec.
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
                <Bot className="size-5" />
              </div>
              <span className="font-fraunces font-medium tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                UniqueMe
              </span>
            </Link>
          </h1>
          <div className="flex items-center gap-2 sm:gap-4" role="group" aria-label="User actions">
            <UserProfile />
          </div>
        </nav>
      </header>
    </>
  );
}
