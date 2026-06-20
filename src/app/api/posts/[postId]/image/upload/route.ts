import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";

/**
 * `POST /api/posts/[postId]/image/upload` — user-uploads-their-own-image
 * endpoint backing the "Upload" tab of `<UploadImageDialog>` on
 * `/schedule-posts`.
 *
 * Body: `multipart/form-data` with a single `file` field. Limits are
 * enforced server-side (5MB, PNG/JPG/WEBP only); the dialog mirrors
 * them client-side as early feedback.
 *
 * Flow:
 *   1. Auth (401 on no session).
 *   2. Extract file from FormData (400 on missing).
 *   3. Hand off to `imageService.uploadImageForPost` — it validates size
 *      and mime, resizes to canonical 1080×1080 JPEG via `sharp`,
 *      uploads two independent blobs (post copy + library copy), and
 *      atomically swaps the `post_images` row + inserts a
 *      `library_images` row.
 *   4. Revalidate the three pages that surface this image so they
 *      refresh on the next client navigation.
 *
 * Going with an API route over a server action because multipart
 * uploads are slightly cleaner via Web `Request.formData()` and we get
 * conventional HTTP status codes back for the client to switch on.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ postId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, {
      status: 401,
    });
  }

  const { postId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[api/posts/image/upload] FormData parse failed", err);
    return NextResponse.json({ ok: false, error: "bad_request" }, {
      status: 400,
    });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing_file" }, {
      status: 400,
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const result = await imageService.uploadImageForPost(
    session.user.id,
    postId,
    buffer,
    file.type,
  );

  if (!result.ok) {
    // Map service errors to sensible HTTP status codes. Mirroring the
    // posting-soon action layer's translation pattern — service codes
    // stay typed; the wire surface speaks HTTP.
    const status = mapErrorToStatus(result.error);
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  revalidatePath("/schedule-posts");
  revalidatePath("/posting-soon");
  revalidatePath("/library");
  return NextResponse.json({ ok: true, imageUrl: result.imageUrl });
}

function mapErrorToStatus(
  error:
    | "not_found"
    | "not_owned"
    | "too_large"
    | "bad_mime"
    | "processing_failed"
    | "db_failed",
): number {
  switch (error) {
    case "not_found":
      return 404;
    case "not_owned":
      return 403;
    case "too_large":
      return 413;
    case "bad_mime":
      return 415;
    case "processing_failed":
    case "db_failed":
      return 500;
  }
}
