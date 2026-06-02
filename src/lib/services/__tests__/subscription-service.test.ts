import { describe, it, expect } from "vitest";

// DB strategy (PGlite in-memory / dedicated test DB / function-level mocking)
// is deliberately deferred to task-08. This file is a smoke test only.

describe("subscription-service test infrastructure", () => {
  it("runner is wired up", () => {
    expect(true).toBe(true);
  });
});
