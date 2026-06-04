CREATE TABLE "library_images" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"image_url" text NOT NULL,
	"image_prompt" text NOT NULL,
	"source" text NOT NULL,
	"origin_post_id" text,
	"origin_batch_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_images" ADD CONSTRAINT "library_images_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_images_user_created_idx" ON "library_images" USING btree ("user_id","created_at");