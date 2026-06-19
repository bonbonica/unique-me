"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ClipboardList,
  Image as ImageIcon,
  Settings,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * Sidebar navigation items, declared in the locked order (navigation
 * redesign Wave 1):
 *
 *   1. Create Posts    — where users start (Sparkles).
 *   2. Schedule Posts  — review/edit/regenerate/schedule the drafted set
 *                        (ClipboardList).
 *   3. Posting Soon    — scheduled posts waiting to publish (Calendar).
 *   4. Image Library   — retained images (ImageIcon).
 *   5. Settings        — account + plan (Settings).
 *   6. Cancelled Posts — single list of every cancelled post; REPOST per
 *                        row (XCircle).
 *
 * `href` matching is prefix-aware so nested routes (e.g. `/schedule-posts/*`)
 * keep the parent item highlighted. The matcher in `isActive` below
 * enforces that.
 */
type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const DASHBOARD_NAV_ITEMS: readonly NavItem[] = [
  { label: "Create Posts", href: "/create", icon: Sparkles },
  { label: "Schedule Posts", href: "/schedule-posts", icon: ClipboardList },
  { label: "Posting Soon", href: "/posting-soon", icon: Calendar },
  { label: "Image Library", href: "/library", icon: ImageIcon },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Cancelled Posts", href: "/cancelled-posts", icon: XCircle },
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
