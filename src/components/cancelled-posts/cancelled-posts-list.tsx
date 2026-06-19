/**
 * Wave 1 placeholder for the Cancelled Posts page's single list section.
 *
 * Design (locked-in 2026-06-19): there is ONE list on the Cancelled Posts
 * page — every cancelled item is treated as an individual cancelled post,
 * whether it was cancelled one-by-one or as part of a whole-batch cancel.
 * No separate "Cancelled batches" section.
 *
 * Wave 4 task-11 replaces the body with the real query against cancelled
 * `scheduled_posts` rows + per-row REPOST action. Repost prompts the user
 * with two options: "Repost where it naturally fits the most" or "Pick a
 * date". Section header and shell-card chrome stay this shape so the swap
 * is body-only.
 */
export function CancelledPostsList() {
  return (
    <section className="bg-card rounded-2xl border border-border shadow-soft p-8 space-y-4">
      <h2 className="font-fraunces text-2xl font-medium tracking-tight">
        Cancelled posts
      </h2>
      <p className="text-sm text-muted-foreground">Nothing cancelled.</p>
    </section>
  );
}
