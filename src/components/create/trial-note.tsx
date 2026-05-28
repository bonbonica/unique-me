/**
 * In-page trial reminder shown above the generate form on `/create` when
 * the user is actively on the 7-day Pro trial. Companion to the persistent
 * `<TrialStrip />` in the TopBar — the strip says "you're on trial", this
 * note adds "and here's why it matters in this exact context".
 *
 * Hidden when:
 *  - status is not "trial" (caller decides; we render unconditionally when
 *    rendered)
 *  - daysLeft is null (caller-protected)
 *  - the user is in the gated state (the gated screen replaces the form
 *    entirely, so this note never renders in that flow)
 */
export function TrialNote({ daysLeft }: { daysLeft: number }) {
  return (
    <p className="text-sm text-muted-foreground">
      You&apos;re trying Pro features free for {daysLeft}{" "}
      {daysLeft === 1 ? "more day" : "more days"}.
    </p>
  );
}
