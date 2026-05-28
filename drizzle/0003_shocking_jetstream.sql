CREATE TABLE "post_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_variations" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"post_text" text NOT NULL,
	"hashtags" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "regeneration_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_selections" ADD CONSTRAINT "post_selections_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_selections" ADD CONSTRAINT "post_selections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_variations" ADD CONSTRAINT "post_variations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_variations" ADD CONSTRAINT "post_variations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_selections_post_platform_unique" ON "post_selections" USING btree ("post_id","platform");--> statement-breakpoint
CREATE INDEX "post_selections_user_id_idx" ON "post_selections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_variations_post_platform_unique" ON "post_variations" USING btree ("post_id","platform");--> statement-breakpoint
CREATE INDEX "post_variations_user_id_idx" ON "post_variations" USING btree ("user_id");