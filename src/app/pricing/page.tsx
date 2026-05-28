/**
 * Placeholder pricing page (Phase 2). Linked from `<TrialGatedScreen />` on
 * `/create` when a trial user has used their one batch. Phase 4 will
 * replace this with the real pricing table + Polar checkout flow described
 * in `UniqueMe pdf/Payment_Integration_Commands_UniqueMe.pdf`.
 *
 * Public route (no auth required) so a curious visitor can land on it from
 * marketing channels too. Kept simple on purpose — the real designs land
 * with the real flow, not now.
 */
export default function PricingPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-start justify-center px-5 sm:px-8 py-16 sm:py-24">
      <div className="max-w-md text-center space-y-6">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Plans are on the way
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Pricing and checkout land soon. Until then, you can keep exploring
          the trial.
        </p>
      </div>
    </div>
  );
}
