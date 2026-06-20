"use client";

import { useState, useTransition } from "react";
import { Facebook, Instagram, Linkedin } from "lucide-react";
import { toast } from "sonner";
import { scheduleAllForNetworkAction } from "@/app/(app)/(onboarded)/schedule-posts/actions";
import { Button } from "@/components/ui/button";
import type { SelectionPlatform } from "@/lib/schema";
import type {
  BatchGroup,
  UnscheduledPostRowData,
} from "@/lib/services/post-service";
import { cn } from "@/lib/utils";
import { UnscheduledPostRow } from "./unscheduled-post-row";

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
 * Tabbed network view for `/schedule-posts`. One tab per platform in
 * `platforms` (the user's `profile.platforms`). Each tab lists every
 * unscheduled `(post, platform)` combo for that network, grouped by
 * batch with a theme + important-thing header (week separator).
 *
 * Per-tab bulk button "Schedule all N {Network} posts" sits above the
 * groups when the active tab has at least one unscheduled row.
 *
 * Local component state for the active tab (no URL persistence).
 */
export function SchedulePostsTabs({
  platforms,
  postsByPlatform,
  isPro,
}: {
  platforms: SelectionPlatform[];
  postsByPlatform: Record<
    SelectionPlatform,
    BatchGroup<UnscheduledPostRowData>[]
  >;
  isPro: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SelectionPlatform | null>(
    platforms[0] ?? null,
  );
  const [bulkPending, startBulkTransition] = useTransition();

  if (platforms.length === 0) {
    return (
      <p className="text-base text-muted-foreground leading-7">
        No connected networks. Add a network in Settings to start creating
        posts.
      </p>
    );
  }

  const activeGroups = activeTab ? postsByPlatform[activeTab] : [];
  const activeRowCount = activeGroups.reduce(
    (sum, group) => sum + group.rows.length,
    0,
  );

  function handleScheduleAll() {
    if (!activeTab) return;
    const platform = activeTab;
    startBulkTransition(async () => {
      const result = await scheduleAllForNetworkAction(platform);
      if (!result.ok) {
        toast.error("Couldn't schedule all posts.");
        return;
      }
      if (result.added === 0) {
        toast.success("Nothing to schedule.");
      } else {
        toast.success(
          `Scheduled ${result.added} ${PLATFORM_LABEL[platform]} ${result.added === 1 ? "post" : "posts"}.`,
        );
      }
    });
  }

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
              aria-controls={`schedule-posts-panel-${platform}`}
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
          id={`schedule-posts-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`schedule-posts-tab-${activeTab}`}
          className="space-y-6"
        >
          {activeRowCount === 0 ? (
            <p className="text-base text-muted-foreground leading-7">
              No posts in review for {PLATFORM_LABEL[activeTab]}.
            </p>
          ) : (
            <>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full glow-champagne"
                  onClick={handleScheduleAll}
                  disabled={bulkPending}
                >
                  {bulkPending
                    ? "Scheduling…"
                    : `Schedule all ${activeRowCount} ${PLATFORM_LABEL[activeTab]} ${activeRowCount === 1 ? "post" : "posts"}`}
                </Button>
              </div>
              {activeGroups.map((group) => (
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
                        <UnscheduledPostRow row={row} isPro={isPro} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
