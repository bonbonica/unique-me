"use client"

import { Check, X } from "lucide-react"
import {
  evaluatePassword,
  getStrengthLabel,
  passwordRequirements,
} from "@/lib/password-strength"
import { cn } from "@/lib/utils"

type PasswordStrengthMeterProps = {
  password: string
  /** Hide the visual entirely until the user starts typing. */
  hideWhenEmpty?: boolean
  className?: string
}

/**
 * Tier-driven palette. Sits inside the UniqueMe gold family at the top end
 * and uses the design-system status colours (destructive / amber / emerald)
 * for the weaker tiers.
 */
const TIER_BAR_COLOR: Record<number, string> = {
  0: "bg-muted",
  1: "bg-destructive",
  2: "bg-amber-300",
  3: "bg-primary",
  4: "bg-emerald-300",
}

const TIER_TEXT_COLOR: Record<number, string> = {
  0: "text-muted-foreground",
  1: "text-destructive",
  2: "text-amber-300",
  3: "text-primary",
  4: "text-emerald-300",
}

export function PasswordStrengthMeter({
  password,
  hideWhenEmpty = false,
  className,
}: PasswordStrengthMeterProps) {
  const { checks, score } = evaluatePassword(password)
  const label = getStrengthLabel(score)
  const hasInput = password.length > 0

  if (hideWhenEmpty && !hasInput) {
    return null
  }

  // When empty, the bars show as muted and the label is suppressed so the
  // checklist remains the focal point.
  const tier = hasInput ? score : 0

  return (
    <div className={cn("space-y-3", className)} aria-live="polite">
      <div className="flex items-center gap-2" aria-hidden="true">
        <div className="flex flex-1 gap-1.5">
          {[1, 2, 3, 4].map((segment) => (
            <div
              key={segment}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                segment <= tier ? TIER_BAR_COLOR[tier] : "bg-muted"
              )}
            />
          ))}
        </div>
        {hasInput && (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              TIER_TEXT_COLOR[tier]
            )}
          >
            {label}
          </span>
        )}
      </div>

      <ul className="space-y-1.5 text-xs">
        {passwordRequirements.map((req) => {
          const met = checks[req.key]
          return (
            <li
              key={req.key}
              className={cn(
                "flex items-center gap-2 transition-colors duration-200",
                met ? "text-emerald-300" : "text-muted-foreground"
              )}
            >
              {met ? (
                <Check
                  className="size-3.5 shrink-0"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              ) : (
                <X
                  className="size-3.5 shrink-0 text-muted-foreground/70"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              )}
              <span>{req.label}</span>
              <span className="sr-only">
                {met ? "requirement met" : "requirement not met"}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
