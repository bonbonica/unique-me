/**
 * Parity + rollover suite for subscription-service Pro behavior (D-A15).
 *
 * DB strategy: PGlite in-memory via `@electric-sql/pglite` + `drizzle-orm/pglite`.
 * The production `@/lib/db` import is replaced with a PGlite-backed Drizzle
 * instance via `vi.mock`. Schema is applied inline via raw `pg.exec` CREATE
 * TABLE statements covering only the three tables this suite touches —
 * drizzle-kit migration files are NOT replayed. If schema drift becomes a
 * concern, switch to a dedicated Postgres test DB.
 *
 * Regression contract: future plan tiers must preserve the canGenerate /
 * nextResetAt agreement asserted by `expectAgreement` in every Pro scenario.
 */

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/schema";

// The `vi.mock` factory below needs access to the PGlite-backed drizzle
// instance, but `vi.mock` is hoisted above all module-scope `const`
// declarations. To bridge that, we keep the instance on a `globalThis` slot —
// the factory reads it lazily on first access (the production `@/lib/db`
// import is only consumed once `subscription-service` runs queries, which
// happens inside `it()` blocks, long after this file's top-level code has
// run).
declare global {
  // `var` is mandatory inside `declare global` — `let`/`const` are not
  // hoisted onto the global object, which is exactly the affordance we need.
  var __UM_TEST_DB__:
    | { pg: PGlite; testDb: ReturnType<typeof drizzle<typeof schema>> }
    | undefined;
}

const pg = new PGlite();
const testDb = drizzle(pg, { schema });
globalThis.__UM_TEST_DB__ = { pg, testDb };

// Replace the production DB import with the PGlite-backed Drizzle instance.
// The factory resolves lazily — by the time the service issues its first
// query, `globalThis.__UM_TEST_DB__` is populated.
vi.mock("@/lib/db", () => ({
  get db() {
    const handle = globalThis.__UM_TEST_DB__;
    if (!handle) {
      throw new Error("Test DB not initialized — check test bootstrap");
    }
    return handle.testDb;
  },
}));

// IMPORTANT: import the service AFTER the mock declaration. The hoisting of
// `vi.mock` guarantees the mock is registered before this import resolves.
import * as subscriptionService from "@/lib/services/subscription-service";

// =============================================================================
// Schema bootstrap
// =============================================================================

/**
 * Inline DDL for the three tables this suite touches. Mirrors the columns in
 * `src/lib/schema.ts` (and the migrations through `0006`) closely enough that
 * the service queries resolve. We deliberately omit unrelated tables (posts,
 * profiles, sessions, etc.) — they aren't read by the code paths under test.
 */
const SCHEMA_SQL = `
  CREATE TABLE "user" (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    email_verified boolean NOT NULL DEFAULT false,
    image text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );

  CREATE TABLE subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    plan text NOT NULL,
    status text NOT NULL,
    trial_start_date timestamp NOT NULL,
    trial_end_date timestamp NOT NULL,
    billing_cycle text,
    posts_used_this_month integer NOT NULL DEFAULT 0,
    regenerations_during_trial integer NOT NULL DEFAULT 0,
    plan_changed_at timestamp NOT NULL DEFAULT now(),
    period_start_date timestamp NOT NULL DEFAULT now(),
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );

  CREATE TABLE weekly_batches (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    theme text NOT NULL,
    important_thing text NOT NULL,
    total_posts integer NOT NULL DEFAULT 7,
    day_window integer,
    batch_ordinal_in_period integer,
    accepted_posts integer NOT NULL DEFAULT 0,
    skipped_posts integer NOT NULL DEFAULT 0,
    status text NOT NULL,
    post_length text,
    posting_days text,
    created_at timestamp NOT NULL DEFAULT now(),
    deleted_at timestamp
  );
`;

beforeAll(async () => {
  await pg.exec(SCHEMA_SQL);
});

beforeEach(async () => {
  // Order matters — `weekly_batches.user_id` and `subscriptions.user_id`
  // reference `user.id` conceptually. We don't enforce FKs in the test DDL,
  // but the deletion order matches what a real cascade would expect and keeps
  // intent obvious.
  await pg.exec(
    `DELETE FROM weekly_batches; DELETE FROM subscriptions; DELETE FROM "user";`,
  );
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

// =============================================================================
// Seed helpers
// =============================================================================

type BatchStatus =
  | "in_progress"
  | "reviewing"
  | "scheduling"
  | "scheduled"
  | "completed"
  | "cancelled";

type SeedProOpts = {
  periodStartDate: Date;
  planChangedAt: Date;
  batchCreatedAts: Date[];
  batchStatuses?: BatchStatus[];
};

/**
 * Seed an active Pro user: one `user` row, one `subscriptions` row anchored to
 * the supplied dates, and N `weekly_batches` rows with the given createdAt
 * timestamps. All non-essential subscription fields get sensible defaults so
 * each scenario can stay focused on the dates that matter.
 */
async function seedPro(opts: SeedProOpts): Promise<{ userId: string }> {
  const userId = crypto.randomUUID();
  const trialStart = new Date(opts.periodStartDate.getTime() - 30 * 86_400_000);
  const trialEnd = new Date(trialStart.getTime() + 7 * 86_400_000);

  await testDb.insert(schema.user).values({
    id: userId,
    name: "Pro Test User",
    email: `pro-${userId}@example.test`,
  });

  await testDb.insert(schema.subscriptions).values({
    id: crypto.randomUUID(),
    userId,
    plan: "pro",
    status: "active",
    trialStartDate: trialStart,
    trialEndDate: trialEnd,
    billingCycle: "monthly",
    postsUsedThisMonth: 0,
    regenerationsDuringTrial: 0,
    planChangedAt: opts.planChangedAt,
    periodStartDate: opts.periodStartDate,
  });

  for (let i = 0; i < opts.batchCreatedAts.length; i++) {
    const createdAt = opts.batchCreatedAts[i];
    const status = opts.batchStatuses?.[i] ?? "reviewing";
    await testDb.insert(schema.weeklyBatches).values({
      id: crypto.randomUUID(),
      userId,
      theme: "test theme",
      importantThing: "test important thing",
      totalPosts: 7,
      status,
      createdAt,
    });
  }

  return { userId };
}

/**
 * Seed an active Starter user. Used only by scenario #10 to exercise the
 * non-Pro → Pro transition path in `setPlan` (D-A18).
 */
async function seedStarter(opts: {
  periodStartDate: Date;
  planChangedAt: Date;
}): Promise<{ userId: string }> {
  const userId = crypto.randomUUID();
  const trialStart = new Date(opts.periodStartDate.getTime() - 30 * 86_400_000);
  const trialEnd = new Date(trialStart.getTime() + 7 * 86_400_000);

  await testDb.insert(schema.user).values({
    id: userId,
    name: "Starter Test User",
    email: `starter-${userId}@example.test`,
  });

  await testDb.insert(schema.subscriptions).values({
    id: crypto.randomUUID(),
    userId,
    plan: "starter",
    status: "active",
    trialStartDate: trialStart,
    trialEndDate: trialEnd,
    billingCycle: "monthly",
    postsUsedThisMonth: 0,
    regenerationsDuringTrial: 0,
    planChangedAt: opts.planChangedAt,
    periodStartDate: opts.periodStartDate,
  });

  return { userId };
}

// =============================================================================
// Parity helper (D-A15)
// =============================================================================

/**
 * Locks the contract that `canGenerate` and `nextResetAt` cannot drift on Pro.
 * Future plan tiers added to the discriminated unions must preserve this
 * invariant — extend the branches here when they land.
 */
function expectAgreement(
  gate: Awaited<ReturnType<typeof subscriptionService.canGenerate>>,
  reset: Awaited<ReturnType<typeof subscriptionService.nextResetAt>>,
) {
  if (gate.allowed) {
    expect(reset.at).toBeNull();
  } else if (gate.reason === "monthly_cap_active") {
    expect(reset.at).not.toBeNull();
    expect(reset.at?.getTime()).toBe(gate.nextResetAt.getTime());
  }
}

// =============================================================================
// Time / date helpers
// =============================================================================

const DAY_MS = 86_400_000;
const PERIOD_MS = 30 * DAY_MS;
const PERIOD_START = new Date("2026-01-01T00:00:00.000Z");

function daysAfterPeriodStart(days: number, extraMs = 0): Date {
  return new Date(PERIOD_START.getTime() + days * DAY_MS + extraMs);
}

// =============================================================================
// Scenarios 1–9: Pro parity + rollover
// =============================================================================

describe("Pro canGenerate / nextResetAt parity", () => {
  it("1. Pro with 0 batches → allowed, no reset date", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [],
    });
    vi.setSystemTime(daysAfterPeriodStart(1));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    expect(gate).toEqual({ allowed: true });
    expect(reset).toEqual({ at: null, reason: "no_batch_yet" });
    expectAgreement(gate, reset);
  });

  it("2. Pro with 1 batch in period → allowed, no reset date", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [daysAfterPeriodStart(1)],
    });
    vi.setSystemTime(daysAfterPeriodStart(2));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    expect(gate).toEqual({ allowed: true });
    expect(reset).toEqual({ at: null, reason: "no_batch_yet" });
    expectAgreement(gate, reset);
  });

  it("3. Pro with 3 batches in period → allowed, no reset date", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(2),
        daysAfterPeriodStart(3),
      ],
    });
    vi.setSystemTime(daysAfterPeriodStart(4));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    expect(gate).toEqual({ allowed: true });
    expect(reset).toEqual({ at: null, reason: "no_batch_yet" });
    expectAgreement(gate, reset);
  });

  it("4. Pro with 4 batches in period → monthly_cap_active, reset = periodStart + 30d", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(2),
        daysAfterPeriodStart(3),
        daysAfterPeriodStart(4),
      ],
    });
    vi.setSystemTime(daysAfterPeriodStart(5));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    const expectedReset = new Date(PERIOD_START.getTime() + PERIOD_MS);
    expect(gate).toEqual({
      allowed: false,
      reason: "monthly_cap_active",
      nextResetAt: expectedReset,
      batchesUsed: 4,
    });
    expect(reset.at).not.toBeNull();
    expect(reset.at?.getTime()).toBe(expectedReset.getTime());
    expectAgreement(gate, reset);
  });

  it("5. Pro with 4 batches, time = periodStart + 30d − 1ms → still capped", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(2),
        daysAfterPeriodStart(3),
        daysAfterPeriodStart(4),
      ],
    });
    vi.setSystemTime(daysAfterPeriodStart(30, -1));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    const expectedReset = new Date(PERIOD_START.getTime() + PERIOD_MS);
    expect(gate).toEqual({
      allowed: false,
      reason: "monthly_cap_active",
      nextResetAt: expectedReset,
      batchesUsed: 4,
    });
    expect(reset.at?.getTime()).toBe(expectedReset.getTime());
    expectAgreement(gate, reset);
  });

  it("6. Pro with 4 batches, time = periodStart + 30d → rolled over, allowed (no DB write)", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(2),
        daysAfterPeriodStart(3),
        daysAfterPeriodStart(4),
      ],
    });
    vi.setSystemTime(daysAfterPeriodStart(30));

    // D-A11: anchor must not move on read. Snapshot before, snapshot after.
    const before = await testDb.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.userId, userId),
    });

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    const after = await testDb.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.userId, userId),
    });

    expect(gate).toEqual({ allowed: true });
    expect(reset).toEqual({ at: null, reason: "no_batch_yet" });
    expectAgreement(gate, reset);

    // Anchor unchanged — pure-JS rollover, no write on read.
    expect(before?.periodStartDate.getTime()).toBe(PERIOD_START.getTime());
    expect(after?.periodStartDate.getTime()).toBe(PERIOD_START.getTime());
  });

  it("7. Pro, plan changed AFTER last batch → allowed (D-A13 cutoff resets)", async () => {
    const lastBatchAt = daysAfterPeriodStart(2);
    const planChangedAt = daysAfterPeriodStart(3);

    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt,
      // Four batches — but all of them predate the plan change, so none count.
      batchCreatedAts: [
        daysAfterPeriodStart(0.5),
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(1.5),
        lastBatchAt,
      ],
    });
    vi.setSystemTime(daysAfterPeriodStart(4));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    expect(gate).toEqual({ allowed: true });
    expect(reset).toEqual({ at: null, reason: "no_batch_yet" });
    expectAgreement(gate, reset);
  });

  it("8. Pro with mix of scheduled + cancelled batches summing to 4 → capped (D-A16)", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(2),
        daysAfterPeriodStart(3),
        daysAfterPeriodStart(4),
      ],
      // Two scheduled, two cancelled — still consume four slots.
      batchStatuses: ["scheduled", "cancelled", "scheduled", "cancelled"],
    });
    vi.setSystemTime(daysAfterPeriodStart(5));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    const expectedReset = new Date(PERIOD_START.getTime() + PERIOD_MS);
    expect(gate).toEqual({
      allowed: false,
      reason: "monthly_cap_active",
      nextResetAt: expectedReset,
      batchesUsed: 4,
    });
    expect(reset.at?.getTime()).toBe(expectedReset.getTime());
    expectAgreement(gate, reset);
  });

  it("9. Pro with 4 batches across two periods (3 old + 1 new) → allowed", async () => {
    const { userId } = await seedPro({
      periodStartDate: PERIOD_START,
      planChangedAt: PERIOD_START,
      batchCreatedAts: [
        // Three batches in the FIRST period (days 1–3 after anchor).
        daysAfterPeriodStart(1),
        daysAfterPeriodStart(2),
        daysAfterPeriodStart(3),
        // One batch in the SECOND period (day 31 — just after rollover).
        daysAfterPeriodStart(31),
      ],
    });
    // System time mid-way through second period.
    vi.setSystemTime(daysAfterPeriodStart(32));

    const gate = await subscriptionService.canGenerate(userId);
    const reset = await subscriptionService.nextResetAt(userId);

    expect(gate).toEqual({ allowed: true });
    expect(reset).toEqual({ at: null, reason: "no_batch_yet" });
    expectAgreement(gate, reset);
  });
});

// =============================================================================
// Scenarios 10–11: setPlan upgrade semantics (D-A18)
// =============================================================================

describe("setPlan upgrade semantics", () => {
  it("10. setPlan(userId, 'pro') on a Starter row sets periodStartDate AND planChangedAt to now", async () => {
    const originalAnchor = new Date("2025-11-01T00:00:00.000Z");
    const { userId } = await seedStarter({
      periodStartDate: originalAnchor,
      planChangedAt: originalAnchor,
    });

    const upgradeTime = new Date("2026-02-15T12:00:00.000Z");
    vi.setSystemTime(upgradeTime);

    await subscriptionService.setPlan(userId, "pro");

    const row = await testDb.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.userId, userId),
    });

    expect(row).toBeDefined();
    expect(row?.plan).toBe("pro");
    // Within ~1s of the mocked clock — gives the service room to use either
    // `new Date()` or `Date.now()` without flakiness.
    expect(
      Math.abs((row?.periodStartDate.getTime() ?? 0) - upgradeTime.getTime()),
    ).toBeLessThan(1000);
    expect(
      Math.abs((row?.planChangedAt.getTime() ?? 0) - upgradeTime.getTime()),
    ).toBeLessThan(1000);
    // Sanity: the original anchor is gone.
    expect(row?.periodStartDate.getTime()).not.toBe(originalAnchor.getTime());
  });

  it("11. setPlan(userId, 'pro') on an already-Pro row leaves periodStartDate untouched, bumps planChangedAt", async () => {
    const originalAnchor = new Date("2026-01-01T00:00:00.000Z");
    const { userId } = await seedPro({
      periodStartDate: originalAnchor,
      planChangedAt: originalAnchor,
      batchCreatedAts: [],
    });

    const reCallTime = new Date("2026-01-20T12:00:00.000Z");
    vi.setSystemTime(reCallTime);

    await subscriptionService.setPlan(userId, "pro");

    const row = await testDb.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.userId, userId),
    });

    expect(row).toBeDefined();
    expect(row?.plan).toBe("pro");
    // periodStartDate must be unchanged — re-anchoring would silently double
    // the user's monthly quota (D-A18 narrative).
    expect(row?.periodStartDate.getTime()).toBe(originalAnchor.getTime());
    // planChangedAt is bumped on every setPlan call.
    expect(
      Math.abs((row?.planChangedAt.getTime() ?? 0) - reCallTime.getTime()),
    ).toBeLessThan(1000);
  });
});
