# Phase 4 — Themed Sequential Batches

**Status:** Draft for review.
**Depends on:** scheduling and background-job infrastructure that does not exist yet — specifically the Phase-7 posting cron and the `scheduled_posts.scheduledTime` writer (deferred per the Stage-2 spec). This spec **cannot be implemented** until that infrastructure is planned and built.
**Companion:** Section A of the Pro monthly quota work (4 batches per 30-day period, no-wait between batches, 7/7/7/9 batch sizing) is specced + shipped in `specs/phase-4-pro-monthly-quota/spec.md`. Read that first — this spec assumes the per-batch theme + per-period ordinal + 4-batch cap are in place.

---

## B1. Intent

A Pro user can, in a single session, create their (up to 4) allowed batches **one after another** — not all at once in a single bulk action — so that **between each batch they can set a different theme / focus**, and schedule them across the 30-day period.

## B2. Locked decisions

- **D-B1.** Batches are created **sequentially**, one at a time, each as its own themed batch — never a single bulk "generate 4 identical batches" action.
- **D-B2.** Each batch carries its **own theme** (and optional extra detail/notes), set by the user before generating that batch.
- **D-B3.** The user can stop after any number of batches (1, 2, 3, or 4) and come back later within the period to make more, up to the 4-batch cap from Section A.
- **D-B4.** Scheduling: the user can assign each batch to a slot/date across the 30-day period. *(Exact scheduling model — manual dates vs. auto-spread weekly — is a build decision and depends on the scheduling infrastructure.)*

## B3. Data model (depends on infra)

- **D-B5.** Each `weekly_batch` (or its successor) needs a `theme` field (text, nullable) and optional `themeNotes` (text, nullable). *Status today: `weekly_batches.theme` already exists (text, NOT NULL). `weekly_batches.importantThing` already exists (text, NOT NULL) and plays the role of `themeNotes` under a different name. A literal `themeNotes` column does not exist. Resolve nullability + naming at build time.*
- **D-B6.** A scheduled publish time per batch/post — owned by the not-yet-built scheduling infrastructure. This spec cannot be completed without it. *Status today: `scheduled_posts.scheduledTime` exists in the schema but no writer populates it (Phase-4 posting cron deferred per Stage-2 spec §0).*

## B4. Open questions (resolve before building)

- Does "schedule across the period" mean the user picks exact dates, or the system auto-spreads 4 batches ~weekly across the 30 days?
- Does each batch still generate the same number of posts, or does post count vary? *(Note: Section A locks Pro batch sizes at 7 / 7 / 7 / 9 by ordinal; this question may already be settled there.)*
- How does the themed flow interact with the existing single-batch create flow — replace it for Pro, or sit alongside it?
- What happens to scheduled-but-unpublished batches if the user downgrades?

## B5. Out of scope

- Building the scheduling / background-job infrastructure itself (separate foundational work — Phase 7 territory).
- Auto-posting to social platforms (later phase).
