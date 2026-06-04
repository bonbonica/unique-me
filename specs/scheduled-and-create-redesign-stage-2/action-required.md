# Action Required — Scheduled & Create Posts Redesign Stage 2

Manual steps that cannot be automated by coder agents.

## Before Implementation

- [ ] **Confirm `BLOB_READ_WRITE_TOKEN` is set in `.env`.** The `image-service.ts` deletion helper relies on `@vercel/blob`'s `del()`. Without this token, every Stage-2 deletion path silently logs `blob_orphan` rows. Verify with `pnpm tsx --env-file=.env -e "console.log(!!process.env.BLOB_READ_WRITE_TOKEN)"` — should print `true`.
- [ ] **Local Postgres is running** (`docker compose up -d`) so `pnpm db:migrate` can apply the Wave-1 migration.

## During Implementation

- [ ] **Apply the Wave-1 migration locally.** After task-01 generates `drizzle/000N_library_images.sql`, the coder must run:
  ```
  pnpm db:generate    # produces the SQL — review the diff before committing
  pnpm db:migrate     # applies locally
  ```
  **Never run `pnpm db:push`** — direct schema sync bypasses the migration history and breaks teammates' local DBs.
- [ ] **Review the generated migration SQL** for the `library_images` table before committing. Confirm: `user_id` FK is `ON DELETE CASCADE`; the `(user_id, created_at)` index is present; no other tables were modified.
- [ ] **Capture the dormant `currently_posting` emerald box screenshot** if the Wave-6 verification calls for refreshing it (the Stage-1 capture remains valid unless the box anatomy changes — Stage-2 only adds the 7-day strip, so it likely needs a re-capture).

## After Implementation

- [ ] **Vercel deploy check.** After merging to main, watch the Vercel build (typically ~2–4 minutes for a Next.js production rebuild). The Wave-1 migration runs as part of `pnpm build` (per `package.json` scripts) — if it fails, the deploy fails. Roll back via Vercel UI if needed.
- [ ] **Production `BLOB_READ_WRITE_TOKEN`** must be set on the Vercel project before any production user can trigger a deletion path. Add via Vercel dashboard → Project → Settings → Environment Variables.
- [ ] **Manually walk through `verification.md`** (Wave-6 artifact). The runbook covers every plan × batch-state combination plus the rolling-4 eviction smoke. Save the artifact to the spec folder with PASS/FAIL marks.

---

> These tasks are also referenced in context within the relevant task files (Wave 1, Wave 6).
