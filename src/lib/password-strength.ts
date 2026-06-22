/**
 * Shared password policy for sign-up and password-reset flows.
 *
 * Requirements: ≥ 8 chars, ≥ 1 letter, ≥ 1 number, ≥ 1 symbol. Kept in sync
 * with the visual meter so the inline checklist and the gate use the same
 * rules.
 */

export type PasswordCheckKey = "length" | "letter" | "number" | "symbol"

export type PasswordChecks = Record<PasswordCheckKey, boolean>

export type PasswordRequirement = {
  key: PasswordCheckKey
  /** Title-cased copy shown next to each item in the checklist UI. */
  label: string
  /** Lowercase fragment composed into inline error sentences. */
  errorPhrase: string
  test: (password: string) => boolean
}

export const passwordRequirements: readonly PasswordRequirement[] = [
  {
    key: "length",
    label: "At least 8 characters",
    errorPhrase: "at least 8 characters",
    test: (p) => p.length >= 8,
  },
  {
    key: "letter",
    label: "One letter (a–z or A–Z)",
    errorPhrase: "a letter",
    test: (p) => /[A-Za-z]/.test(p),
  },
  {
    key: "number",
    label: "One number (0–9)",
    errorPhrase: "a number",
    test: (p) => /\d/.test(p),
  },
  {
    key: "symbol",
    label: "One symbol (e.g. ! @ # $)",
    errorPhrase: "a symbol",
    // Anything that isn't a letter, digit, or whitespace counts as a symbol.
    test: (p) => /[^A-Za-z0-9\s]/.test(p),
  },
] as const

export type PasswordEvaluation = {
  checks: PasswordChecks
  /** Count of satisfied requirements, 0–4. */
  score: number
  /** True when every requirement is met. */
  isValid: boolean
}

export function evaluatePassword(password: string): PasswordEvaluation {
  const checks = passwordRequirements.reduce<PasswordChecks>(
    (acc, req) => {
      acc[req.key] = req.test(password)
      return acc
    },
    { length: false, letter: false, number: false, symbol: false }
  )

  const score = Object.values(checks).filter(Boolean).length
  const isValid = score === passwordRequirements.length

  return { checks, score, isValid }
}

export type PasswordStrengthLabel =
  | "Too weak"
  | "Weak"
  | "Good"
  | "Strong"

export function getStrengthLabel(score: number): PasswordStrengthLabel {
  if (score <= 1) return "Too weak"
  if (score === 2) return "Weak"
  if (score === 3) return "Good"
  return "Strong"
}

/**
 * Friendly, single-sentence message naming the missing requirement(s). Used
 * when the form blocks submission so the user sees one clear next step
 * instead of "invalid password".
 */
export function getFriendlyError(checks: PasswordChecks): string {
  const missing = passwordRequirements
    .filter((req) => !checks[req.key])
    .map((req) => req.errorPhrase)

  if (missing.length === 0) {
    return "Please choose a stronger password."
  }

  if (missing.length === 1) {
    return `Your password still needs ${missing[0]}.`
  }

  const last = missing[missing.length - 1]
  const head = missing.slice(0, -1).join(", ")
  return `Your password still needs ${head}, and ${last}.`
}
