/**
 * Type + initial-state surface for the {@link generateWeeklyAction} server
 * action. Lives in its own module (not `actions.ts`) because Next.js's
 * `"use server"` directive forbids non-async-function value exports —
 * `INITIAL_GENERATE_STATE` is a plain object, so it can't live alongside
 * the server action it pairs with.
 *
 * Both `actions.ts` (for the action's parameter/return types) and
 * `generate-form.tsx` (for the `useActionState` typing + initial value)
 * import from here.
 */

export type GenerateActionState = { error?: string };

export const INITIAL_GENERATE_STATE: GenerateActionState = {};
