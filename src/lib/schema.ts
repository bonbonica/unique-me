import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// IMPORTANT! ID fields should ALWAYS use UUID types, EXCEPT the BetterAuth tables.


export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("user_email_idx").on(table.email)]
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("session_user_id_idx").on(table.userId),
    index("session_token_idx").on(table.token),
  ]
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    index("account_provider_account_idx").on(table.providerId, table.accountId),
  ]
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// =============================================================================
// UniqueMe application tables
// =============================================================================
//
// Conventions (per AGENTS.md):
// - All non-BetterAuth tables use UUID primary keys generated client-side via
//   crypto.randomUUID(). We use text() with $defaultFn for portability across
//   drivers (works without the pgcrypto extension being explicitly required).
// - All userId foreign keys reference user.id with onDelete: "cascade".
// - Enum-like columns are stored as text() and constrained at the service layer
//   via the union types exported at the bottom of this file. This is easier to
//   evolve than pg native enums (which require migrations to add values).
// - All tables get createdAt; tables that mutate also get updatedAt with
//   $onUpdate(() => new Date()).
// - Column names are snake_case in the DB; TS properties are camelCase.

/**
 * Shape of the JSON object returned by the website analyzer (Phase 1).
 * Stored verbatim on the profile so post-generation prompts (Phase 2+) can
 * draw on it without re-scraping.
 */
export type WebsiteAnalysis = {
  businessSummary: string;
  servicesOffered: string[];
  targetAudience: string;
  brandTone: string;
  uniqueSellingPoints: string[];
  suggestedTopics: string[];
};

export const profiles = pgTable(
  "profiles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    websiteUrl: text("website_url"),
    // JSONB so we can index/query individual keys later if needed.
    websiteAnalysis: jsonb("website_analysis").$type<WebsiteAnalysis>(),
    businessType: text("business_type").notNull(),
    businessDescription: text("business_description").notNull(),
    // Union-typed at the application layer: "casual" | "professional" | "mix".
    tonePreference: text("tone_preference").notNull(),
    // Subset of ["facebook", "instagram", "linkedin"]. At least one required
    // (validated in the service layer, not at the DB).
    platforms: text("platforms").array().notNull(),
    // Onboarding-posting-preferences: user's posting-days preference, seeded
    // in onboarding and editable in Settings. Union "every_day" |
    // "working_days_only" | "weekends_only", enforced at the service layer
    // (matches the enum-as-text convention). NULL on legacy pre-migration
    // rows — service-layer reads NULL as "every_day". weekly_batches has its
    // own frozen-at-creation copy so Settings edits never retroactively
    // shift past batches' calendars.
    postingDays: text("posting_days"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // One profile per user. Enforced at the DB so a race can never produce
    // duplicate rows even if the service-layer check misses.
    uniqueIndex("profiles_user_id_unique").on(table.userId),
  ]
);

export const weeklyBatches = pgTable(
  "weekly_batches",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    theme: text("theme").notNull(),
    importantThing: text("important_thing").notNull(),
    totalPosts: integer("total_posts").default(7).notNull(),
    // Onboarding-posting-preferences: calendar-span size in consecutive days
    // (7 for trial/starter/Pro batches 1–3; 9 for the Pro monthly bonus batch
    // 4). Decoupled from total_posts because posting_days filters can drop
    // slots, so total_posts <= day_window under working_days_only or
    // weekends_only. NULL on legacy rows — calendar reader falls back to
    // total_posts (preserves the old every_day-equivalent behaviour).
    dayWindow: integer("day_window"),
    // Pro-only: 1..4 ordinal slot this batch occupies within the user's
    // current 30-day Pro period (D-A9). Nullable because Starter/Trial batches
    // have no meaningful ordinal — the union {1,2,3,4} is enforced at the
    // service layer, not the DB (matches the enum-as-text convention).
    batchOrdinalInPeriod: integer("batch_ordinal_in_period"),
    acceptedPosts: integer("accepted_posts").default(0).notNull(),
    skippedPosts: integer("skipped_posts").default(0).notNull(),
    // Union: "in_progress" | "reviewing" | "scheduling" | "scheduled" | "completed".
    status: text("status").notNull(),
    // Union: "short" | "medium" | "long" | "mix" (PostLength; "mix" added in
    // the onboarding-posting-preferences feature). NULL = legacy Phase 2
    // batch; render/prompt sites must treat NULL as "medium" for back-compat.
    postLength: text("post_length"),
    // Onboarding-posting-preferences: frozen-at-creation copy of the user's
    // posting_days preference. profiles.posting_days seeds it; later edits in
    // Settings do NOT propagate back here so past batches stay stable. Union
    // "every_day" | "working_days_only" | "weekends_only". NULL on legacy
    // rows — calendar reader treats as "every_day".
    postingDays: text("posting_days"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Quota-integrity soft-delete tombstone. NULL on live rows; a non-NULL
    // timestamp marks the moment deleteBatchForever fired. The three quota
    // gates (trial existence, Starter most-recent, Pro 30-day count) read
    // tombstoned rows so a delete never refunds a slot. Every user-facing
    // list/read in postService filters `deleted_at IS NULL` so tombstones
    // vanish from the UI. See specs/quota-soft-delete/spec.md.
    deletedAt: timestamp("deleted_at"),
    // Image-generation Wave 1: shared visual-style directive produced by
    // the same Anthropic caption call. Every post_images row in this batch
    // uses the same style + a per-post imagePrompt subject so the set
    // reads as a cohesive series. Nullable: legacy pre-Wave-1 batches have
    // no style. Stored on the batch (not per-post) because it's shared
    // across all images by definition. See specs/image-generation/spec.md.
    batchImageStyle: text("batch_image_style"),
  },
  (table) => [index("weekly_batches_user_id_idx").on(table.userId)]
);

export const posts = pgTable(
  "posts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a batch removes its posts.
    batchId: text("batch_id")
      .notNull()
      .references(() => weeklyBatches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postText: text("post_text").notNull(),
    hashtags: text("hashtags").array().notNull(),
    // 1-7. Bounds are validated in the service layer, not at the DB, so we
    // can adjust the batch size in future without a migration.
    postOrder: integer("post_order").notNull(),
    // Union: "draft" | "accepted" | "edited" | "skipped". Phase 2 writes only
    // "draft" (initial) and "edited" (after update/regenerate); the "accepted"
    // and "skipped" values stay in the union for backwards compatibility but
    // are not produced by Phase 2 code (selection state superseded them).
    status: text("status").notNull(),
    // Per-post regeneration support (Phase 2). `feedback` holds the free-text
    // note the user typed when clicking "Regenerate this post"; passed to
    // Claude on the regenerate call. `regenerationCount` is bumped only by
    // postService.regenerate and is the universal 1x cap (D11) enforcement
    // column — all plans, all users, no exceptions.
    feedback: text("feedback"),
    regenerationCount: integer("regeneration_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Bumped automatically on every Drizzle-driven update of this row via
    // $onUpdate (postService.update + postService.regenerate). Phase 2's
    // /posts wizard reads this to compare against post_variations.createdAt
    // so the IG / LinkedIn steps can surface a "this variation may be
    // older than the canonical post" inline note (spec R12).
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("posts_batch_id_idx").on(table.batchId),
    index("posts_user_id_idx").on(table.userId),
  ]
);

/**
 * Per-post text variations for Instagram and LinkedIn (Phase 2). The canonical
 * Facebook caption lives on `posts.postText`; this table holds the
 * platform-adapted rewrites. Pro users get both; Starter users get none
 * (Phase 3 will gate the insert site). Facebook IS NOT a valid platform here
 * — see VariationPlatform type.
 */
export const postVariations = pgTable(
  "post_variations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a post removes its variations.
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Union: "instagram" | "linkedin" (VariationPlatform).
    platform: text("platform").notNull(),
    postText: text("post_text").notNull(),
    hashtags: text("hashtags").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // A post has at most one variation per platform.
    uniqueIndex("post_variations_post_platform_unique").on(
      table.postId,
      table.platform
    ),
    index("post_variations_user_id_idx").on(table.userId),
  ]
);

/**
 * Per-post-per-network user opt-in selections (Phase 2). Row presence = the
 * user wants this post published on this network. Row absence = don't post.
 * Mutable while the parent batch is in status "reviewing"; frozen once the
 * batch transitions to "scheduling" or later.
 *
 * Facebook IS a valid platform here (unlike post_variations) — selecting FB
 * is an explicit user opt-in per D14, never a default.
 */
export const postSelections = pgTable(
  "post_selections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a post removes its selections.
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Union: "facebook" | "instagram" | "linkedin" (SelectionPlatform).
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // A post is selected per-platform at most once.
    uniqueIndex("post_selections_post_platform_unique").on(
      table.postId,
      table.platform
    ),
    index("post_selections_user_id_idx").on(table.userId),
  ]
);

export const postImages = pgTable(
  "post_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a post removes its images.
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Nullable: an image URL only exists once `status = 'success'`. For
    // `pending` / `generating` / `failed` rows this stays NULL. The
    // semantic invariant `image_url IS NOT NULL iff status = 'success'`
    // is enforced at the service layer, not the DB.
    imageUrl: text("image_url"),
    imagePrompt: text("image_prompt").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    selected: boolean("selected").default(false).notNull(),
    // Union: "ai" | "uploaded" | "library".
    source: text("source").notNull(),
    // Union: "pending" | "generating" | "success" | "failed" | "regenerating".
    // Lifecycle: INSERT with "pending" → "generating" when OpenAI call starts
    // → "success" (image_url written) or "failed" (OpenAI / Blob threw).
    // Wave 2 retry/regenerate (attempt=2): a "failed" row can transition back
    // to "generating" (retry, all tiers) and a "success" row to "regenerating"
    // (Pro-only). "regenerating" preserves image_url so the tile can show the
    // original dimmed while attempt 2 is in flight; on regenerate failure the
    // row reverts to "success" with image_url intact (original survives).
    // Default "pending" so pre-Wave-1 inserts not aware of the column
    // still produce a sensible row state.
    status: text("status").notNull().default("pending"),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("post_images_post_id_idx").on(table.postId),
    index("post_images_user_id_idx").on(table.userId),
  ]
);

/**
 * Stage-2 D-S2-4. One row per image the user has chosen to retain after the
 * originating post was hard-deleted (per-post cancel, delete-batch-forever,
 * rolling-4 eviction overflow). Cap = 30 per user, enforced by image-service
 * via per-user pg_advisory_xact_lock + oldest-by-createdAt eviction.
 *
 * Deliberately has NO FK to `posts` — by the time we insert here, the
 * originating post row has already been deleted by the caller. `originPostId`
 * and `originBatchId` are audit-only text fields, NOT references.
 *
 * Blob lifecycle: when this row exists, `library_images.imageUrl` OWNS the
 * Vercel Blob URL. Deleting this row MUST go through `image-service.ts` so
 * the blob `del()` fires first.
 */
export const libraryImages = pgTable(
  "library_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a user removes their library.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    // Union: "ai" | "uploaded". NOT "library" — this table IS the library, so
    // "library" as a source value here would be self-referential nonsense.
    source: text("source").notNull(),
    // Audit-only. No FK — see docblock above.
    originPostId: text("origin_post_id"),
    originBatchId: text("origin_batch_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Composite index on (userId, createdAt). Supports:
    //  - listLibrary: WHERE userId = ? ORDER BY createdAt DESC
    //  - eviction:   WHERE userId = ? ORDER BY createdAt ASC LIMIT N
    index("library_images_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Union: "free_trial" | "starter" | "pro".
    plan: text("plan").notNull(),
    // Union: "trial" | "active" | "cancelled" | "expired".
    status: text("status").notNull(),
    trialStartDate: timestamp("trial_start_date").notNull(),
    trialEndDate: timestamp("trial_end_date").notNull(),
    // Union: "monthly" | "yearly" (nullable while on trial).
    billingCycle: text("billing_cycle"),
    postsUsedThisMonth: integer("posts_used_this_month").default(0).notNull(),
    regenerationsDuringTrial: integer("regenerations_during_trial")
      .default(0)
      .notNull(),
    // Not updatedAt: that bumps on unrelated writes (postsUsedThisMonth, etc.), so plan-change detection (D5) needs its own column.
    planChangedAt: timestamp("plan_changed_at").notNull().defaultNow(),
    // Immutable anchor for the Pro rolling 30-day quota window (D-A7). Set
    // when the row is created; rolled forward by the period-tick logic when
    // a new period starts. Unused for trial/Starter rows but kept NOT NULL
    // with a `now()` default so every row has a stable value.
    periodStartDate: timestamp("period_start_date").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // One subscription row per user (active or otherwise).
    uniqueIndex("subscriptions_user_id_unique").on(table.userId),
  ]
);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Union: "facebook" | "instagram" | "linkedin".
    platform: text("platform").notNull(),
    // Tokens are encrypted (AES-256-GCM, ENCRYPTION_KEY env). Phase 5+.
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at"),
    accountName: text("account_name").notNull(),
    // Union: "active" | "expired" | "disconnected".
    status: text("status").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // A user connects each platform at most once.
    uniqueIndex("connected_accounts_user_platform_unique").on(
      table.userId,
      table.platform
    ),
  ]
);

export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Cascade: deleting a post removes its schedule entries.
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // set null: if the user disconnects an account, the scheduled post should
    // fail loudly at publish time rather than vanish silently.
    connectedAccountId: text("connected_account_id").references(
      () => connectedAccounts.id,
      { onDelete: "set null" }
    ),
    // Union: "facebook" | "instagram" | "linkedin".
    platform: text("platform").notNull(),
    scheduledTime: timestamp("scheduled_time").notNull(),
    // Union: "pending" | "posted" | "failed" | "cancelled". The "cancelled"
    // value is set only by postService.cancelPost (D-S2-6, spec) and reversed
    // by postService.restorePost (D-S2-21).
    status: text("status").notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    postedAt: timestamp("posted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("scheduled_posts_user_id_idx").on(table.userId),
    index("scheduled_posts_post_id_idx").on(table.postId),
    // The cron job (Phase 4) queries by status + scheduledTime.
    index("scheduled_posts_status_scheduled_time_idx").on(
      table.status,
      table.scheduledTime
    ),
  ]
);

export const postLogs = pgTable(
  "post_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // set null: preserve audit history even if the source rows are deleted.
    scheduleId: text("schedule_id").references(() => scheduledPosts.id, {
      onDelete: "set null",
    }),
    postId: text("post_id").references(() => posts.id, {
      onDelete: "set null",
    }),
    platform: text("platform"),
    // Union: "posted" | "failed" | "retried" | "scheduled" | "cancelled".
    action: text("action").notNull(),
    // Free-form structured detail (error message, response payload, etc.).
    details: jsonb("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("post_logs_schedule_id_idx").on(table.scheduleId),
    index("post_logs_post_id_idx").on(table.postId),
  ]
);

// =============================================================================
// Inferred row types
// =============================================================================

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type WeeklyBatch = typeof weeklyBatches.$inferSelect;
export type NewWeeklyBatch = typeof weeklyBatches.$inferInsert;

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export type PostImage = typeof postImages.$inferSelect;
export type NewPostImage = typeof postImages.$inferInsert;

export type LibraryImage = typeof libraryImages.$inferSelect;
export type NewLibraryImage = typeof libraryImages.$inferInsert;

export type PostVariation = typeof postVariations.$inferSelect;
export type NewPostVariation = typeof postVariations.$inferInsert;

export type PostSelection = typeof postSelections.$inferSelect;
export type NewPostSelection = typeof postSelections.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type NewConnectedAccount = typeof connectedAccounts.$inferInsert;

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type NewScheduledPost = typeof scheduledPosts.$inferInsert;

export type PostLog = typeof postLogs.$inferSelect;
export type NewPostLog = typeof postLogs.$inferInsert;

// =============================================================================
// Application-level union types for enum-like text columns
// =============================================================================

export type TonePreference = "casual" | "professional" | "mix";
export type Platform = "facebook" | "instagram" | "linkedin";
// Mirrors Platform value-wise but names the per-post selection concept. Same
// union, different intent — use SelectionPlatform when the value represents
// "which network this specific post is opted-in for", and Platform when it
// represents "platforms on the user's profile".
export type SelectionPlatform = "facebook" | "instagram" | "linkedin";
// Subset of platforms that receive per-post text variations. Facebook is
// the canonical row on posts and never appears here.
export type VariationPlatform = "instagram" | "linkedin";
export type BatchStatus =
  | "in_progress"
  | "reviewing"
  | "scheduling"
  | "scheduled"
  | "completed"
  | "cancelled";
export type PostStatus = "draft" | "accepted" | "edited" | "skipped";
export type ImageSource = "ai" | "uploaded" | "library";
export type SubscriptionPlan = "free_trial" | "starter" | "pro";
export type PostLength = "short" | "medium" | "long" | "mix";
// Onboarding-posting-preferences: per-user (and per-batch) preference for
// which calendar days within the batch window receive posts. "every_day"
// keeps every slot; "working_days_only" drops Sat+Sun; "weekends_only" keeps
// only Sat+Sun. Wave 1 stores the value; Wave 2 wires it into
// resolveBatchPlan + ordinalToDate. NULL on legacy rows reads as "every_day".
export type PostingDays = "every_day" | "working_days_only" | "weekends_only";
export type SubscriptionStatus = "trial" | "active" | "cancelled" | "expired";
export type BillingCycle = "monthly" | "yearly";
export type ConnectedAccountStatus = "active" | "expired" | "disconnected";
export type ScheduledPostStatus =
  | "pending"
  | "posted"
  | "failed"
  | "cancelled";
export type PostLogAction =
  | "posted"
  | "failed"
  | "retried"
  | "scheduled"
  | "cancelled";
