import { CancelledPostsList } from "@/components/cancelled-posts/cancelled-posts-list";

/**
 * `/cancelled-posts` — Wave 1 shell. A single list section is wired so
 * Wave 4 (task-11) can swap its body for the real query + REPOST action
 * without touching the page-level layout.
 *
 * Design note (locked-in 2026-06-19): one list, every item is an
 * individual cancelled post. No separate "Cancelled batches" section.
 */
export default function CancelledPostsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="font-fraunces text-3xl sm:text-4xl tracking-tight font-medium">
          Cancelled Posts
        </h1>
        <p className="text-base text-muted-foreground leading-7">
          Cancelled posts. Repost any of them from here.
        </p>
      </header>
      <CancelledPostsList />
    </div>
  );
}
