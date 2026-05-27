"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { DashboardNavList } from "@/components/dashboard/sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Hamburger trigger + slide-in nav drawer for screens below the `md`
 * breakpoint. The desktop {@link DashboardSidebar} is hidden on mobile, so
 * this is the only nav surface available to small viewports.
 *
 * State is controlled locally rather than relying solely on Radix's
 * uncontrolled mode so we can dismiss the sheet when the user picks a link —
 * Radix's `Dialog` (which `Sheet` wraps) does not auto-close on inner
 * navigation events, and leaving it open after a route change looks broken.
 */
export function DashboardMobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden flex items-center px-5 py-3 border-b border-border">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-card w-72 p-0">
          {/*
            SheetTitle + SheetDescription are required by Radix for a11y;
            we keep them visually hidden to avoid duplicating the nav label
            while still announcing the drawer's purpose to assistive tech.
          */}
          <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Jump to a section of your UniqueMe dashboard.
          </SheetDescription>
          <DashboardNavList onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
