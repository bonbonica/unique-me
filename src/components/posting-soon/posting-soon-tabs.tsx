"use client";

import { useState } from "react";
import { Facebook, Instagram, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SelectionPlatform } from "@/lib/schema";
import type { ScheduledPostRowData } from "@/lib/services/post-service";
import { cn } from "@/lib/utils";
import { ScheduledPostRow } from "./scheduled-post-row";

const PLATFORM_LABEL: Record<SelectionPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};

const PLATFORM_ICON: Record<
  SelectionPlatform,
  typeof Facebook
> = {
  facebook: Facebook,
  instagram: Instagram,
  linkedin: Linkedin,
};

/**
 * Tabbed network view for `/posting-soon`. One tab per platform listed in
 * `platforms` (the user's onboarding selection — `profile.platforms`).
 * Each tab renders every scheduled (post, platform) row for that network,
 * already ordered by scheduled date ascending by the server.
 *
 * No persistent URL state — the initial tab is whichever platform appears
 * first in `platforms`; switching tabs is local component state. Light
 * enough that a navigation round-trip isn't worth the friction.
 */
export function PostingSoonTabs({
  platforms,
  postsByPlatform,
}: {
  platforms: SelectionPlatform[];
  postsByPlatform: Record<SelectionPlatform, ScheduledPostRowData[]>;
}) {
  const [activeTab, setActiveTab] = useState<SelectionPlatform | null>(
    platforms[0] ?? null,
  );

  if (platforms.length === 0) {
    return (
      <p className="text-base text-muted-foreground leading-7">
        No connected networks. Add a network in Settings to start scheduling
        posts.
      </p>
    );
  }

  const activePosts = activeTab ? postsByPlatform[activeTab] : [];

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Network"
        className="flex flex-wrap gap-2 border-b border-border"
      >
        {platforms.map((platform) => {
          const Icon = PLATFORM_ICON[platform];
          const isActive = platform === activeTab;
          const count = postsByPlatform[platform].length;
          return (
            <Button
              key={platform}
              role="tab"
              type="button"
              variant="ghost"
              aria-selected={isActive}
              aria-controls={`posting-soon-panel-${platform}`}
              onClick={() => setActiveTab(platform)}
              className={cn(
                "gap-2 rounded-none rounded-t-lg border-b-2 px-4",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className="size-4"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {PLATFORM_LABEL[platform]}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </Button>
          );
        })}
      </div>

      {activeTab ? (
        <div
          id={`posting-soon-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`posting-soon-tab-${activeTab}`}
          className="space-y-4"
        >
          {activePosts.length === 0 ? (
            <p className="text-base text-muted-foreground leading-7">
              No posts scheduled to {PLATFORM_LABEL[activeTab]} yet.
            </p>
          ) : (
            <ul className="space-y-4">
              {activePosts.map((row) => (
                <li key={`${row.postId}-${row.platform}`}>
                  <ScheduledPostRow row={row} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
