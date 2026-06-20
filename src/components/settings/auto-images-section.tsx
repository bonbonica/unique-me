"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateGenerateImagesAutomaticallyAction } from "@/app/(app)/(onboarded)/settings/actions";
import { cn } from "@/lib/utils";

type Props = {
  /** Current persisted value from `profiles.generate_images_automatically`. */
  initial: boolean;
};

/**
 * Settings → "Generate images automatically" toggle. Controls whether
 * `postService.generateWeekly` runs the AI image-generation fan-out on
 * new batches.
 *
 * On (default): every new batch gets AI-generated images attached, same
 * as before this toggle existed. Off: batches land with no images;
 * the user uploads their own per post via the `<UploadImageDialog>`
 * on `/schedule-posts`.
 *
 * Visual mirrors `<PostingDaysSection />` so the two cards feel
 * parallel — same card chrome, same pill-toggle group, same
 * optimistic + revert-on-failure pattern.
 */
export function AutoImagesSection({ initial }: Props) {
  const headingId = useId();
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    if (next === enabled) return;

    const previous = enabled;
    setEnabled(next);

    startTransition(async () => {
      const result = await updateGenerateImagesAutomaticallyAction(next);
      if (result.ok) {
        toast.success(
          next
            ? "Automatic image generation turned on."
            : "Automatic image generation turned off.",
        );
        return;
      }
      setEnabled(previous);
      toast.error("Couldn't save your preference. Try again.");
    });
  }

  return (
    <section className="bg-card rounded-2xl p-8 shadow-soft border border-border space-y-4">
      <p
        id={headingId}
        className="font-fraunces text-xl font-medium tracking-tight"
      >
        Generate images automatically
      </p>
      <p className="text-sm text-muted-foreground leading-7">
        When on, UniqueMe creates an AI image for every post in a new
        batch. When off, posts arrive without images and you can upload
        your own.
      </p>

      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className="inline-flex rounded-full bg-muted p-1 border border-border"
      >
        {(
          [
            { value: true, label: "On" },
            { value: false, label: "Off" },
          ] as const
        ).map((option) => {
          const selected = enabled === option.value;
          return (
            <label
              key={String(option.value)}
              className="relative cursor-pointer"
            >
              <input
                type="radio"
                name="generate_images_automatically"
                value={String(option.value)}
                checked={selected}
                disabled={pending}
                onChange={() => handleChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "block px-5 py-2 rounded-full text-sm font-medium transition-colors duration-200",
                  "peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/30 peer-focus-visible:outline-none",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent/40",
                )}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Applies to your next batch. Current batches keep their images.
      </p>
    </section>
  );
}
