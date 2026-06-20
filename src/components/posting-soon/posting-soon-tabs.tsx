"use client";

import { useState } from "react";
import { Facebook, Instagram, Linkedin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SelectionPlatform } from "@/lib/schema";
import type {
  BatchGroup,
  ScheduledPostRowData,
} from "@/lib/services/post-service";
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
 * `platforms` (the user's `profile.platforms`). Each tab lists every
 * scheduled `(post, platform)` row for that network, grouped by batch
 * with a theme + important-thing header (week separator). Within a
 * group, rows are pre-ordered ascending by scheduled date.
 *
 * No persistent URL state — initial tab is the first platform; switching
 * tabs is local component state.
 */
export function PostingSoonTabs({
  platforms,
  postsByPlatform,
}: {
  platforms: SelectionPlatform[];
  postsByPlatform: Record<
    SelectionPlatform,
    BatchGroup<ScheduledPostRowData>[]
  >;
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

  const activeGroups = activeTab ? postsByPlatform[activeTab] : [];
  const activeRowCount = activeGroups.reduce(
    (sum, group) => sum + group.rows.length,
    0,
  );

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
          const count = postsByPlatform[platform].reduce(
            (sum, group) => sum + group.rows.length,
            0,
          );
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
          className="space-y-6"
        >
          {activeRowCount === 0 ? (
            <p className="text-base text-muted-foreground leading-7">
              No posts scheduled to {PLATFORM_LABEL[activeTab]} yet.
            </p>
          ) : (
            activeGroups.map((group) => (
              <section key={group.batchId} className="space-y-3">
                <header className="space-y-1">
                  <h2 className="font-fraunces text-xl font-medium tracking-tight">
                    {group.batchTheme}
                  </h2>
                  {group.batchImportantThing ? (
                    <p className="text-sm text-muted-foreground leading-6">
                      {group.batchImportantThing}
                    </p>
                  ) : null}
                </header>
                <ul className="space-y-4">
                  {group.rows.map((row) => (
                    <li key={`${row.postId}-${row.platform}`}>
                      <ScheduledPostRow row={row} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
