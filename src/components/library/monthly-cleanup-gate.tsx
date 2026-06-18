"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  checkMonthlyCleanupAction,
  runMonthlyCleanupAction,
} from "@/app/(app)/(onboarded)/library/actions";
import { CleanupReminderDialog } from "@/components/library/cleanup-reminder-dialog";

/**
 * Onboarded-layout cleanup gate (Wave 3 Stage 4). Resolves the user's
 * browser TZ month, asks the server whether cleanup is needed, then:
 *  - shows the cleanup reminder modal (over cap + not dismissed),
 *  - runs cleanup silently (over cap + previously dismissed),
 *  - does nothing (under cap or already checked this month).
 *
 * Fires AT MOST ONCE per session via a sessionStorage flag (survives
 * client-side navigation between onboarded pages) and a ref guard (so
 * React 18 Strict Mode's double-mount doesn't double-fire the check).
 */
export function MonthlyCleanupGate() {
  const fired = useRef(false);
  const [reminder, setReminder] = useState<{
    count: number;
    over: number;
    currentMonthYyyyMm: string;
  } | null>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    if (sessionStorage.getItem("library:monthly-cleanup-checked") === "1") {
      return;
    }
    sessionStorage.setItem("library:monthly-cleanup-checked", "1");

    const currentMonthYyyyMm = computeCurrentMonth();

    void (async () => {
      try {
        const result = await checkMonthlyCleanupAction(currentMonthYyyyMm);
        if (!result.ok) return;
        if (!result.cleanupNeeded) return;

        if (result.shouldShowReminder) {
          setReminder({
            count: result.count,
            over: result.over,
            currentMonthYyyyMm,
          });
          return;
        }

        // Silent path — user previously dismissed the reminder. Run
        // cleanup directly and only toast if something was actually
        // removed (no toast spam on empty cleanup runs).
        const cleanup = await runMonthlyCleanupAction(currentMonthYyyyMm);
        if (cleanup.ok && cleanup.action === "ran" && cleanup.deleted > 0) {
          toast.info(
            `Cleaned up ${cleanup.deleted} unlocked ${cleanup.deleted === 1 ? "image" : "images"}.`,
          );
        }
      } catch (err) {
        console.error("[monthly-cleanup-gate] check failed", err);
      }
    })();
  }, []);

  if (!reminder) return null;

  return (
    <CleanupReminderDialog
      open={true}
      onOpenChange={(open) => {
        if (!open) setReminder(null);
      }}
      count={reminder.count}
      over={reminder.over}
      currentMonthYyyyMm={reminder.currentMonthYyyyMm}
    />
  );
}

/**
 * Browser-local `YYYY-MM`. We use the local date components, not UTC, so a
 * user on the US east coast at 11pm on the 31st gets "this month" rather
 * than "next month". Server stores this string verbatim — equality check
 * is what determines "first visit of new month".
 */
function computeCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
