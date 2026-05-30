# Phase 3 backlog

Findings deferred from earlier phases. Each item names where it was surfaced so the context can be picked up without re-discovering the bug.

## Open

### Website-analyzer schema mismatch — `targetAudience` length cap
- **Surfaced:** Phase 2 task-14 audit (User B onboarding, 2026-05-30 session log).
- **Symptom:** `[website-analyzer] tool input failed schema validation` with `fieldErrors: { targetAudience: ['Too big: expected string to have <=300 characters'] }`. Onboarding still completes (the analyzer tolerates the failure), but the Zod schema rejects the AI's tool output before persistence.
- **Where to look:** `src/lib/ai/website-analyzer.ts` (Zod schema) and the analyzer prompt that produces `targetAudience`.
- **Fix options:** widen the Zod cap, trim the value at the boundary, or constrain the prompt so the AI returns shorter strings. Pick whichever keeps the downstream UX intact.
- **Severity:** low — no crash, no data corruption, but the cached analysis goes to waste when validation fails, forcing a live re-scrape on save.

### Trial abuse — no multi-account / disposable-email throttle
- **Surfaced:** Phase 2 task-14 cross-check vs. `Security_Audit_Commands_UniqueMe.pdf` risk #6.
- **Symptom:** A user can register an unlimited number of accounts with disposable emails (e.g. `+suffix@gmail.com` aliases, mailinator, etc.) and get a fresh trial each time. The trial-1-batch cap (D20) is per-user, not per-email-domain or per-device.
- **Mitigation options (PDF suggests):**
  - Track signups by normalised email (strip `+suffix`, lowercase, treat known disposable-email domains as a single bucket).
  - Limit trials per email domain.
  - Require email verification before granting trial access.
  - Add a per-IP / per-device fingerprint heuristic for high-volume abusers.
- **Severity:** medium — purely a credit-cost / unit-economics concern, not a data-safety one. Must land **before public launch** but is not a Phase 3 blocker for credit / payment work.
