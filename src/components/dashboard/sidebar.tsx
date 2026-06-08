"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  Image as ImageIcon,
  Send,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Sidebar navigation items, declared in the locked order:
 *
 *   1. Create Posts        — where users start (Sparkles).
 *   2. Currently Posting   — what's live on social media right now (Send).
 *   3. Scheduled           — upcoming batch grid (Calendar).
 *   4. Image Library       — retained images (ImageIcon).
 *   5. Settings            — account + plan (Settings).
 *
 * "Currently Posting" deep-links into the locked-summary view of the batch
 * whose posting window is currently active. The href targets
 * `/posts/currently-posting` — a thin server route that re-resolves the
 * batch via `postService.getCurrentlyPostingBatch` (Pro: ordinal matching
 * the current period week; Starter / Trial: their single scheduling /
 * completed batch) and redirects to `/posts?batchId={id}`. Same helper the
 * `<CurrentlyPostingCta />` on `/create` uses, so the sidebar and the CTA
 * always land on the same batch. When no batch is currently posting the
 * route renders a calm empty state instead of redirecting.
 *
 * "My Posts" was removed in the prior redesign — visiting `/posts` or
 * `/posts?batchId={id}` intentionally no longer highlights any sidebar
 * item; the `/posts` route remains accessible to deep links and bookmarks.
 *
 * `href` matching is prefix-aware so nested routes (e.g. `/create/*`) keep
 * the parent item highlighted. The matcher in `isActive` below enforces that.
 */
type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const DASHBOARD_NAV_ITEMS: readonly NavItem[] = [
  { label: "Create Posts", href: "/create", icon: Sparkles },
  {
    label: "Currently Posting",
    href: "/posts/currently-posting",
    icon: Send,
  },
  { label: "Scheduled", href: "/schedule", icon: Calendar },
  { label: "Image Library", href: "/library", icon: ImageIcon },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

/**
 * True when the current pathname matches the nav item exactly, or is a nested
 * route underneath it (e.g. `/create/abc` keeps `Create Posts` highlighted).
 */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shared list of nav links — extracted so both the persistent desktop aside
 * and the mobile Sheet content render the exact same markup. `onNavigate`
 * lets the mobile variant dismiss the sheet on link click; the desktop
 * variant omits it.
 */
export function DashboardNavList({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav
      className="py-6 space-y-1"
      aria-label="Dashboard navigation"
    >
      {DASHBOARD_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        // We only spread `onClick` when the caller provided a handler.
        // `exactOptionalPropertyTypes: true` treats `onClick={undefined}`
        // as an assignment of `undefined`, which Link's prop type forbids.
        const linkProps = onNavigate ? { onClick: onNavigate } : {};
        return (
          <Link
            key={item.href}
            href={item.href}
            {...linkProps}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 px-5 py-3 rounded-r-lg text-sm font-medium transition-colors",
              active
                ? "text-primary bg-primary/10 border-l-2 border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-2 border-transparent",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Persistent left rail visible at the `md` breakpoint and above. Mobile uses
 * the separate {@link DashboardMobileNav} component (rendered alongside this
 * one by the layout) so the responsive variants stay decoupled.
 */
export function DashboardSidebar() {
  return (
    <aside
      className="hidden md:block w-60 shrink-0 border-r border-border bg-background"
      aria-label="Primary"
    >
      <DashboardNavList />
    </aside>
  );
}
