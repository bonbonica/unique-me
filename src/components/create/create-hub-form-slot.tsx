"use client";

import { createContext, useContext, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { GenerateForm } from "./generate-form";

/**
 * Client wrapper that coordinates the "Start new batch" toggle on
 * `/create` (D-S14). The Create Posts hub is mostly server-rendered, but
 * the form-expand state is interactive — this file colocates the small
 * amount of client state into one provider + two consumers so the rest of
 * the page tree stays a server component.
 *
 * Flow:
 *   - `<CreateHubFormProvider initiallyExpanded={...}>` wraps both the
 *     `<UnscheduledBatchList />` (top of the hub) and the form slot
 *     (bottom). `initiallyExpanded` is decided server-side:
 *       - true  when zero cards exist + form is allowed → fresh-state
 *               users land directly on the form;
 *       - false when 1+ cards exist + form is allowed → form starts
 *               collapsed, top button toggles it open.
 *   - `<CreateHubStartNewBatchButton />` is injected into the list's
 *     `startNewBatchSlot` prop. Clicking it sets `expanded = true`.
 *   - `<CreateHubFormSlot />` reads `expanded` and renders the form (with
 *     a stable `id` for aria-controls) only when open.
 */

type HubFormContextValue = {
  expanded: boolean;
  setExpanded: (next: boolean) => void;
};

const HubFormContext = createContext<HubFormContextValue | null>(null);

export function CreateHubFormProvider({
  initiallyExpanded,
  children,
}: {
  initiallyExpanded: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <HubFormContext.Provider value={{ expanded, setExpanded }}>
      {children}
    </HubFormContext.Provider>
  );
}

/**
 * Toggle button injected into `<UnscheduledBatchList />`'s
 * `startNewBatchSlot` prop. Becomes disabled while the form is already
 * expanded — the affordance is "open the form," not "scroll to the form."
 * If the provider isn't mounted (defensive — should never happen in the
 * page tree), the button renders nothing rather than throwing.
 */
export function CreateHubStartNewBatchButton() {
  const ctx = useContext(HubFormContext);
  if (!ctx) return null;
  return (
    <Button
      type="button"
      onClick={() => ctx.setExpanded(true)}
      disabled={ctx.expanded}
      aria-expanded={ctx.expanded}
      aria-controls="create-hub-form"
    >
      Start new batch
    </Button>
  );
}

/**
 * Conditional wrapper around `<GenerateForm />`. Reads the provider's
 * `expanded` flag and renders the form only when true; otherwise emits
 * nothing. The `id` matches the toggle button's `aria-controls` so
 * assistive tech can map the relationship.
 *
 * Props are forwarded 1:1 to `<GenerateForm />` via `ComponentProps` so
 * any future change to the form's signature surfaces here as a compile
 * error rather than a runtime mismatch.
 */
export function CreateHubFormSlot(
  props: ComponentProps<typeof GenerateForm>,
) {
  const ctx = useContext(HubFormContext);
  if (!ctx?.expanded) return null;
  return (
    <div id="create-hub-form">
      <GenerateForm {...props} />
    </div>
  );
}
