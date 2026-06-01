# Task 03: Vitest Infrastructure

## Status
not started

## Wave
1

## Description

Introduce Vitest as the project's test runner. No tests existed before Phase 4; the spec mandates a `canGenerate` / `nextResetAt` parity test (D-A15), which requires a runner.

Scope: install Vitest, configure for the Next.js + TypeScript + path-alias setup, scaffold the first test file with a smoke test, and verify the runner works end-to-end (`pnpm test`).

The actual parity + rollover assertions land in task-08 (which lives in Wave 2 because it depends on the new Pro branches in `subscription-service.ts`).

## Dependencies

**Depends on:** none
**Blocks:** task-08 (parity tests require the runner to exist)
**Context from dependencies:** N/A — foundation task.

## Files to Modify

- `package.json` (modified) — add Vitest dev deps + `test` scripts
- `vitest.config.ts` (new) — runner config at repo root
- `tsconfig.json` (modified if needed) — only if `vitest/globals` need to be added to `types`
- `src/lib/services/__tests__/subscription-service.test.ts` (new) — smoke test scaffold

## Implementation Steps

1. Install Vitest as a dev dependency:
   ```
   pnpm add -D vitest @vitest/coverage-v8
   ```
   (Coverage is optional but cheap to wire up now.)
2. Add `test` scripts to `package.json`:
   ```json
   "test": "vitest run",
   "test:watch": "vitest"
   ```
   Place adjacent to the existing `lint` / `typecheck` scripts.
3. Create `vitest.config.ts` at the repo root:
   ```ts
   import { defineConfig } from "vitest/config";
   import path from "node:path";

   export default defineConfig({
     test: {
       environment: "node",
       include: ["src/**/*.{test,spec}.ts"],
       globals: false,
     },
     resolve: {
       alias: {
         "@": path.resolve(__dirname, "./src"),
       },
     },
   });
   ```
   `globals: false` keeps imports explicit (`import { describe, it, expect } from "vitest"`) — matches the project's no-implicit-import preference.
4. Create the test directory + smoke test:
   ```
   src/lib/services/__tests__/subscription-service.test.ts
   ```
   Contents:
   ```ts
   import { describe, it, expect } from "vitest";

   describe("subscription-service test infrastructure", () => {
     it("runner is wired up", () => {
       expect(true).toBe(true);
     });
   });
   ```
5. Verify the runner: `pnpm test` should pass with 1/1 green.
6. **Database strategy is NOT decided in this task.** Task-08 will pick between (a) PGlite in-memory + Drizzle's pg adapter, (b) a dedicated test database, or (c) function-level mocking. Document the open choice in the test file header as a comment.

## Acceptance Criteria

- [ ] `vitest` + `@vitest/coverage-v8` appear in `package.json` devDependencies.
- [ ] `pnpm test` exits 0 with one green test.
- [ ] `pnpm test:watch` starts the watcher (manual check; Ctrl+C to exit).
- [ ] `vitest.config.ts` resolves the `@/` path alias the same way `tsconfig.json` does.
- [ ] Smoke test file lives at `src/lib/services/__tests__/subscription-service.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck` exit 0.

## Notes

- Do NOT add `playwright` or any E2E runner in this task. The spec's manual E2E (task 20) is documented in a markdown checklist, not automated.
- Do NOT mock the database in the smoke test — that decision belongs to task-08.
- Vitest is preferred over Jest here for its native ESM support and Next.js / TypeScript ergonomics. No alternative was considered.
- If `tsconfig.json` needs an update to silence type errors on Vitest globals, add the minimal required entry only. Avoid widening `types` more than needed.
- ESLint: Vitest's recommended ESLint plugin is optional. Skip it in this task to keep the diff small; add later if Wave 2 testing reveals lint pain.
