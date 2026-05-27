# Task 01: Schema Migration (0003)

## Status
not started

## Wave
1

## Description

Extend `src/lib/schema.ts` to support Phase 2 post generation: add two columns to `posts` (regen support), add two new sibling tables (`post_variations`, `post_selections`), expand the `BatchStatus` TypeScript union with `"cancelled"`, and export the new platform unions. Then generate + apply migration `0003` via Drizzle.

## Dependencies

**Depends on:** None (foundation task)
**Blocks:** task-02, task-03, task-04, task-05, task-06, task-08
**Context from dependencies:** N/A — this is the foundation.

## Files to Modify / Create

- `src/lib/schema.ts` — MODIFY (add columns, tables, types)
- `drizzle/0003_*.sql` — CREATE via `npm run db:generate`
- `drizzle/meta/0003_snapshot.json` — CREATE via `npm run db:generate`

## Implementation Steps

### 1. Add two columns to the existing `posts` table

Inside the existing `pgTable("posts", { ... })` definition in `schema.ts`, add after `status`:

```ts
feedback: text("feedback"),                                // nullable
regenerationCount: integer("regeneration_count")
  .default(0)
  .notNull(),
```

### 2. Add `post_variations` table

Define after `posts`:

```ts
export const postVariations = pgTable(
  "post_variations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Union: "instagram" | "linkedin". Facebook is the canonical row on posts.
    platform: text("platform").notNull(),
    postText: text("post_text").notNull(),
    hashtags: text("hashtags").array().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("post_variations_post_platform_unique").on(table.postId, table.platform),
    index("post_variations_user_id_idx").on(table.userId),
  ]
);
```

### 3. Add `post_selections` table

```ts
export const postSelections = pgTable(
  "post_selections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Union: "facebook" | "instagram" | "linkedin".
    // Facebook IS included here (unlike post_variations) — selecting FB
    // is an explicit user opt-in (D14), not a default.
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("post_selections_post_platform_unique").on(table.postId, table.platform),
    index("post_selections_user_id_idx").on(table.userId),
  ]
);
```

Row presence = selected. Row absence = not selected. There is no `selected` boolean.

### 4. Add inferred types (next to existing `$inferSelect` exports)

```ts
export type PostVariation = typeof postVariations.$inferSelect;
export type NewPostVariation = typeof postVariations.$inferInsert;

export type PostSelection = typeof postSelections.$inferSelect;
export type NewPostSelection = typeof postSelections.$inferInsert;
```

### 5. Expand `BatchStatus` union

Find the existing line:

```ts
export type BatchStatus =
  | "in_progress"
  | "reviewing"
  | "scheduling"
  | "scheduled"
  | "completed";
```

Append `| "cancelled"`:

```ts
export type BatchStatus =
  | "in_progress"
  | "reviewing"
  | "scheduling"
  | "scheduled"
  | "completed"
  | "cancelled";          // NEW
```

No DB migration needed for this — the column is `text()`.

### 6. Add platform unions (alongside existing `Platform` type)

```ts
export type SelectionPlatform = "facebook" | "instagram" | "linkedin";
export type VariationPlatform = "instagram" | "linkedin";
```

(`SelectionPlatform === Platform` value-wise. Keep both names so reading the code at the selection site is unambiguous.)

### 7. Generate and apply the migration

```
npm run db:generate
npm run db:migrate
```

**NEVER** run `npm run db:push` (per `AGENTS.md`).

Drizzle should produce `drizzle/0003_<random_name>.sql` and `drizzle/meta/0003_snapshot.json`. Commit both.

## Acceptance Criteria

- [ ] `posts.feedback` exists as a nullable text column
- [ ] `posts.regeneration_count` exists as integer NOT NULL DEFAULT 0
- [ ] `post_variations` table exists with the columns + unique index above
- [ ] `post_selections` table exists with the columns + unique index above
- [ ] `BatchStatus` union includes `"cancelled"`
- [ ] `SelectionPlatform` and `VariationPlatform` exported
- [ ] `PostVariation`, `NewPostVariation`, `PostSelection`, `NewPostSelection` exported
- [ ] `drizzle/0003_*.sql` and `drizzle/meta/0003_snapshot.json` checked into git
- [ ] `npm run lint`, `npm run typecheck`, `npm run build:ci` all clean
- [ ] Verifiable via `npm run db:studio`: all three new structures visible

## Notes

- Migration filename is auto-generated by drizzle-kit; don't hand-edit it.
- If `drizzle:generate` emits anything unexpected (e.g., it tries to alter unrelated tables), STOP — diff carefully against schema before applying.
