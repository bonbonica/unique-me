# Task 08: Parity + Rollover Vitest Suite

## Status
not started

## Wave
2

## Description

Fill out the Vitest scaffold from task 03 with the parity + rollover suite mandated by the spec (D-A15). Assert that:

1. `canGenerate` and `nextResetAt` agree across every Pro state (under-cap, at-cap, rollover boundary, plan-change reset).
2. The 30-day rollover is computed correctly in pure JS (D-A11) — no DB writes, regardless of how many times `canGenerate` is called.
3. Cancelled batches count toward the cap (D-A16).
4. `planChangedAt > periodStart` correctly resets the cutoff (D-A13).
5. `setPlan` upgrade semantics are correct (D-A18).

Decide the DB strategy at the top of this task: PGlite in-memory, dedicated test DB, or function-level mocks. Recommendation: **PGlite + drizzle-orm/pglite** — gives real SQL semantics without a network hop or a CI database. Document the choice in the test file's header.

## Dependencies

**Depends on:** tasks 03, 04, 05, 06, 07 (runner + all service changes in place)
**Blocks:** task-19 (full-phase audit reruns the suite)
**Context from dependencies:** Wave 2 service changes complete. The Pro branches in `canGenerate` / `nextResetAt` are observable via the snapshot.

**Wave 2 sequencing:** This task does NOT edit `subscription-service.ts` directly — it writes a sibling test file. It MAY run in parallel with task 07's PR review, but to keep the wave linear we recommend it ships after 07 lands.

## Files to Modify

- `src/lib/services/__tests__/subscription-service.test.ts` (replace smoke scaffold)
- `package.json` (possibly modified) — add `@electric-sql/pglite` + adapter if PGlite is chosen
- `vitest.config.ts` (possibly modified) — `setupFiles` if test bootstrap is needed

## Implementation Steps

### 1. DB strategy decision

Write a header comment at the top of the test file documenting:

- Which approach was chosen (PGlite / test DB / mocks).
- How tests obtain a fresh subscriptions+weekly_batches state per test (transaction rollback / `truncate` / fresh PGlite instance).
- Trade-offs noted (e.g. "PGlite mirrors Postgres semantics but does not run our actual migration files — schema applied inline; if migration drift becomes a problem, switch to a dedicated test DB").

### 2. Test fixtures

A helper that creates a subscription row + N batch rows with controllable timestamps:

```ts
async function seedPro(opts: {
  periodStartDate: Date;
  planChangedAt: Date;
  batchCreatedAts: Date[];
}): Promise<{ userId: string }> {
  // INSERT into user, subscriptions, weekly_batches.
  // Return the userId for the suite to use.
}
```

Plus a `clock(date)` shim — Vitest's `vi.useFakeTimers()` + `vi.setSystemTime()` is sufficient; do not roll your own.

### 3. Required test cases

For each case, assert BOTH `canGenerate` and `nextResetAt` give the expected output AND that they agree (a Pro at-cap user yields `canGenerate.allowed === false` and `nextResetAt.at !== null`; Pro under-cap yields `canGenerate.allowed === true` and `nextResetAt.at === null`).

| # | Scenario | Expected `canGenerate` | Expected `nextResetAt.at` |
|---|---|---|---|
| 1 | Pro, 0 batches | `{ allowed: true }` | `null` |
| 2 | Pro, 1 batch in period | `{ allowed: true }` | `null` |
| 3 | Pro, 3 batches in period | `{ allowed: true }` | `null` |
| 4 | Pro, 4 batches in period | `{ allowed: false, reason: "monthly_cap_active", batchesUsed: 4 }` | `periodStart + 30d` |
| 5 | Pro, 4 batches, exactly at `periodStart + 30d - 1ms` | still capped | `periodStart + 30d` |
| 6 | Pro, 4 batches, exactly at `periodStart + 30d` | allowed (period rolled over) | `null` |
| 7 | Pro, plan changed AFTER the last batch (`planChangedAt > lastBatch.createdAt`) | allowed | `null` |
| 8 | Pro, mix of `scheduled` + `cancelled` batches summing to 4 | capped (D-A16) | `periodStart + 30d` |
| 9 | Pro, 4 batches across TWO periods (3 in old, 1 in new) | allowed | `null` |
| 10 | `setPlan(userId, "pro")` on a Starter row | post-call snapshot shows `periodStartDate ≈ now` AND `planChangedAt ≈ now` | — |
| 11 | `setPlan(userId, "pro")` on an already-Pro row | post-call `periodStartDate` unchanged from before, `planChangedAt` bumped | — |

### 4. Rollover-without-write assertion

For case 6 (period just rolled over), assert that the `subscriptions.period_start_date` column in the DB is **unchanged** after the `canGenerate` call — proves D-A11 is honored (pure JS rollover, no write on read).

### 5. Parity helper

```ts
function expectAgreement(
  gate: Awaited<ReturnType<typeof canGenerate>>,
  reset: Awaited<ReturnType<typeof nextResetAt>>,
) {
  if (gate.allowed) {
    expect(reset.at).toBeNull();
  } else if (gate.reason === "monthly_cap_active") {
    expect(reset.at).not.toBeNull();
    expect(reset.at?.getTime()).toBe(gate.nextResetAt.getTime());
  }
}
```

Call this in every Pro test.

## Acceptance Criteria

- [ ] `pnpm test` runs the full suite green.
- [ ] All 11 scenarios above are tested.
- [ ] Parity helper invoked in every Pro scenario.
- [ ] DB strategy documented in the file header.
- [ ] No `period_start_date` writes observed in the rollover test (case 6).
- [ ] Cancelled batches count (case 8).
- [ ] `setPlan` idempotency preserved for already-Pro rows (case 11).
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- These are the project's first tests. Optimise for clarity over cleverness — each case should be readable as a story (seed state, advance clock, call function, assert).
- Time mocking: prefer `vi.setSystemTime` for `Date.now()`/`new Date()` rather than threading a clock parameter through the service. The service is already calling `new Date()` directly; injecting a clock would be a larger refactor.
- PGlite vs real Postgres: PGlite is the same wire format and SQL dialect; mismatches between it and Neon Postgres are vanishingly rare for our queries. If a suspicious behavior emerges, escalate to a real test DB rather than working around it in tests.
- The parity test is a **regression contract** for future phases. Adding a new plan tier later (e.g. "Pro Plus") that touches `canGenerate` must keep the agreement invariant. Document this in the test file.
- Do not test the UI layers here. Wave 4 UI tests (if added in future phases) belong in a separate file. This task is purely the service contract.
