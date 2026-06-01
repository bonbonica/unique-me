// Phase 1: profile-service. Real implementation — owns the persistence and
// AI-derived enrichment of the user's business profile created at onboarding.

import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { analyzeWebsiteContent } from "@/lib/ai/website-analyzer";
import { db } from "@/lib/db";
import { BUSINESS_TYPES, type BusinessType } from "@/lib/profile/constants";
import {
  type Platform,
  type Profile,
  profiles,
  type WebsiteAnalysis,
} from "@/lib/schema";
import { scrapeWebsite } from "@/lib/scraping/firecrawl";
import { getSubscription } from "./subscription-service";

export { BUSINESS_TYPES, type BusinessType };

const tonePreferenceSchema = z.enum(["casual", "professional", "mix"]);
const platformSchema = z.enum(["facebook", "instagram", "linkedin"]);

/**
 * Input schema for creating or replacing a profile. The dual {@link saveProfile}
 * upsert path means this same shape is used whether the user is on their
 * first onboarding pass or re-running it after edit.
 *
 * Validation rules:
 *   - `businessName` non-empty, ≤200 chars (column has no length limit, but
 *     anything longer is almost certainly junk input).
 *   - `websiteUrl` accepts `null` (the field is optional on the form) but if
 *     provided must be a syntactically valid URL.
 *   - `businessType` is one of the 10 dropdown values — see {@link BUSINESS_TYPES}.
 *   - `businessDescription` non-empty, ≤2000 chars.
 *   - `platforms` at least one entry, restricted to the three supported
 *     platforms (validated again at the DB level via the enum-like text
 *     column convention).
 *   - `websiteAnalysis` is optional and is set by the caller after running
 *     {@link scrapeAndAnalyzeWebsite}; we never derive it inside `saveProfile`
 *     so that side effects (a network call) are isolated.
 */
export const saveProfileSchema = z.object({
  businessName: z.string().min(1).max(200),
  websiteUrl: z.string().url().nullable().optional(),
  businessType: z.enum(BUSINESS_TYPES),
  businessDescription: z.string().min(1).max(2000),
  tonePreference: tonePreferenceSchema,
  platforms: z.array(platformSchema).min(1),
  websiteAnalysis: z
    .object({
      businessSummary: z.string(),
      servicesOffered: z.array(z.string()),
      targetAudience: z.string(),
      brandTone: z.string(),
      uniqueSellingPoints: z.array(z.string()),
      suggestedTopics: z.array(z.string()),
    })
    .nullable()
    .optional(),
});

export type SaveProfileInput = z.infer<typeof saveProfileSchema>;

/**
 * Partial update — all fields optional. Used by the "edit profile" screen in
 * Wave 3+. The platforms array still has a min-1 constraint when supplied.
 */
export const updateProfileSchema = saveProfileSchema.partial();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Fetch a user's profile, or null if onboarding has not been completed.
 */
export async function getProfile(userId: string): Promise<Profile | null> {
  const row = await db.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
  });
  return row ?? null;
}

/**
 * Cheap existence check — selects only the id column so it's safe to call on
 * every authenticated request from middleware. Returns a Promise to keep the
 * API consistent with the rest of the service even though it could be sync.
 */
export async function hasProfile(userId: string): Promise<boolean> {
  const row = await db.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: { id: true },
  });
  return Boolean(row);
}

/**
 * Insert-or-replace the user's profile row. The `profiles_user_id_unique`
 * constraint guarantees one row per user; we use Drizzle's
 * `onConflictDoUpdate` to make the API idempotent on the unique index.
 *
 * Throws `Error("INVALID_INPUT")` on validation failure. Callers in Wave 3
 * (the onboarding action) should catch this and surface a field-level error
 * to the user.
 */
export async function saveProfile(
  userId: string,
  input: SaveProfileInput
): Promise<Profile> {
  const parsed = saveProfileSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("INVALID_INPUT");
  }

  const data = parsed.data;

  /**
   * Starter platform-cap enforcement (Phase 3 D6). The onboarding form
   * (task-14) caps the picker at 2 visually, but that's convenience UX —
   * service-layer enforcement is the correctness gate. A Pro→Starter
   * downgrade does NOT auto-trim `profiles.platforms`, so any subsequent
   * save by a downgraded user could persist 3 platforms unless we refuse
   * here. The error code is local to profileService's union; the
   * complementary `canGenerate` overage check covers the read path.
   */
  const subscription = await getSubscription(userId);
  if (
    subscription?.plan === "starter" &&
    data.platforms.length > 2
  ) {
    throw new Error("PLATFORMS_OVERAGE_FOR_PLAN");
  }

  // Normalize platforms to the schema's branded `Platform[]` type. Zod's
  // enum already constrains values; this is just to satisfy Drizzle's
  // inferred column type.
  const platforms: Platform[] = data.platforms;

  const [row] = await db
    .insert(profiles)
    .values({
      userId,
      businessName: data.businessName,
      websiteUrl: data.websiteUrl ?? null,
      websiteAnalysis: data.websiteAnalysis ?? null,
      businessType: data.businessType,
      businessDescription: data.businessDescription,
      tonePreference: data.tonePreference,
      platforms,
    })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: {
        businessName: data.businessName,
        websiteUrl: data.websiteUrl ?? null,
        websiteAnalysis: data.websiteAnalysis ?? null,
        businessType: data.businessType,
        businessDescription: data.businessDescription,
        tonePreference: data.tonePreference,
        platforms,
      },
    })
    .returning();

  if (!row) {
    // The DB returned no rows from the upsert. This should not be reachable —
    // both INSERT and UPDATE branches of onConflictDoUpdate return the row.
    throw new Error("PROFILE_UPSERT_FAILED");
  }

  return row;
}

/**
 * Apply a partial patch to an existing profile. Returns the updated row.
 * Throws `Error("INVALID_INPUT")` on validation failure and
 * `Error("PROFILE_NOT_FOUND")` if no profile row exists for the user.
 */
export async function updateProfile(
  userId: string,
  patch: UpdateProfileInput
): Promise<Profile> {
  const parsed = updateProfileSchema.safeParse(patch);
  if (!parsed.success) {
    throw new Error("INVALID_INPUT");
  }

  const data = parsed.data;

  /**
   * Starter platform-cap enforcement (Phase 3 D6). Same rationale as
   * {@link saveProfile}: the UI cap is convenience, the service cap is
   * correctness — a Pro→Starter downgrade leaves stale platform arrays in
   * place, so any partial update that touches `platforms` must refuse
   * 3 entries when the user's current plan is Starter. Skipped when the
   * caller didn't supply `platforms` at all.
   */
  if (data.platforms !== undefined && data.platforms.length > 2) {
    const subscription = await getSubscription(userId);
    if (subscription?.plan === "starter") {
      throw new Error("PLATFORMS_OVERAGE_FOR_PLAN");
    }
  }

  // Build the update set with only the fields the caller actually supplied,
  // so an undefined value doesn't accidentally null out a column.
  const set: Partial<typeof profiles.$inferInsert> = {};
  if (data.businessName !== undefined) set.businessName = data.businessName;
  if (data.websiteUrl !== undefined) set.websiteUrl = data.websiteUrl ?? null;
  if (data.websiteAnalysis !== undefined) {
    set.websiteAnalysis = data.websiteAnalysis ?? null;
  }
  if (data.businessType !== undefined) set.businessType = data.businessType;
  if (data.businessDescription !== undefined) {
    set.businessDescription = data.businessDescription;
  }
  if (data.tonePreference !== undefined) {
    set.tonePreference = data.tonePreference;
  }
  if (data.platforms !== undefined) set.platforms = data.platforms;

  const [row] = await db
    .update(profiles)
    .set(set)
    .where(eq(profiles.userId, userId))
    .returning();

  if (!row) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  return row;
}

/**
 * Scrape the user's website and run it through the analyzer. Returns the
 * structured profile or null if either step failed (the underlying calls
 * never throw, so this wrapper does not need its own try/catch).
 *
 * Kept as a separate service method so the onboarding action can call it
 * in parallel with form validation, then pass the result into
 * {@link saveProfile} as the `websiteAnalysis` field.
 */
export async function scrapeAndAnalyzeWebsite(
  url: string
): Promise<WebsiteAnalysis | null> {
  const markdown = await scrapeWebsite(url);
  if (!markdown) {
    return null;
  }
  return analyzeWebsiteContent(markdown);
}
