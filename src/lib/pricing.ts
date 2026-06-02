// Single source of truth for plan labels + prices. UI-only — do not import
// from schema/service layer. One-way dependency: pricing → schema (type-only).

import type { SubscriptionPlan } from "@/lib/schema";

// Phase 4 Pro monthly quota — see specs/phase-4-pro-monthly-quota/spec.md § 1.
export const MAX_BATCHES_PER_PERIOD = 4;
export const ROLLING_PERIOD_DAYS = 30;
export const STANDARD_BATCH_POSTS = 7;
export const PRO_LONG_BATCH_POSTS = 9;

export type PlanDetails = {
  label: string;
  monthlyPriceUsd: number; // 0 sentinel = render as "Free"
  pitch: string; // one-line marketing line
  features: readonly string[]; // bullet list for /pricing cards
};

export const PLAN_DETAILS: Record<SubscriptionPlan, PlanDetails> = {
  free_trial: {
    label: "Free trial",
    monthlyPriceUsd: 0,
    pitch: "Full Pro features, 7 days",
    features: [
      "1 batch lifetime",
      "All 3 platforms",
      "Pick post length",
      "No card required",
    ],
  },
  starter: {
    label: "Starter",
    monthlyPriceUsd: 9.99,
    pitch: "1 batch per week",
    features: [
      "1 batch / week",
      "2 of 3 platforms",
      "All edit + regenerate features",
    ],
  },
  pro: {
    label: "Pro",
    monthlyPriceUsd: 19.99,
    pitch: "4 batches per month, all platforms",
    features: [
      "4 batches / month",
      "All 3 platforms (pick 1–3)",
      "Pick post length (short / medium / long)",
    ],
  },
};

export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free_trial: PLAN_DETAILS.free_trial.label,
  starter: PLAN_DETAILS.starter.label,
  pro: PLAN_DETAILS.pro.label,
};

export function formatMonthlyPrice(plan: SubscriptionPlan): string {
  const price = PLAN_DETAILS[plan].monthlyPriceUsd;
  if (price === 0) {
    return "Free";
  }
  return `$${price.toFixed(2)}/mo`;
}
