import { headers } from "next/headers";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";

// Node runtime required — we use `node:stream`'s Readable.fromWeb /
// Readable.toWeb and pipe through `archiver`, neither of which work on the
// Edge runtime.
export const runtime = "nodejs";
// Disable any caching layer in front of this route — the user's library
// can change between downloads.
export const dynamic = "force-dynamic";

/**
 * Wave 3 image library — bulk ZIP download.
 *
 * Streams a ZIP archive of every image in the user's library. Each entry
 * inside the ZIP is named `image-${index+1}.${ext}` derived from the Blob
 * URL extension (defaults to `png` if the URL has no clear extension —
 * Wave 1 always writes `.png`). The CDN ignores the query string portion
 * of any URL; we include `Cache-Control: no-store` so neither browser nor
 * any intermediate proxy holds onto a stale list.
 *
 * Failure modes:
 *  - Unauthenticated → 401.
 *  - Empty library → 204 No Content (browser won't download anything).
 *  - Per-image fetch errors are logged and skipped; the ZIP still
 *    completes with the rest of the images.
 *  - Top-level archiver errors corrupt the response (truncated ZIP). The
 *    browser surfaces this as a failed download.
 *
 * Streaming model: the archive runs in a background async IIFE that
 * `append()`s each fetched stream and `finalize()`s when done. The HTTP
 * response holds the archive's output stream open so Vercel keeps the
 * worker alive until finalize completes.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const images = await imageService.listLibrary(session.user.id);
  if (images.length === 0) return new Response(null, { status: 204 });

  // archiver v8 dropped the callable factory; the package now exposes
  // ZipArchive / TarArchive / JsonArchive as classes instead.
  const archive = new ZipArchive({ zlib: { level: 6 } });

  archive.on("error", (err: Error) => {
    console.error("[library/download] archiver error", err);
  });

  void (async () => {
    for (const [index, img] of images.entries()) {
      try {
        const response = await fetch(img.imageUrl);
        if (!response.ok || !response.body) {
          console.error("[library/download] fetch failed", {
            url: img.imageUrl,
            status: response.status,
          });
          continue;
        }
        const ext = extensionFromUrl(img.imageUrl) ?? "png";
        // fetch's `response.body` is a web ReadableStream<Uint8Array>;
        // Readable.fromWeb is happy with that shape but @types/node uses
        // the node:stream/web ReadableStream type, hence the cast.
        const nodeStream = Readable.fromWeb(
          response.body as unknown as Parameters<typeof Readable.fromWeb>[0],
        );
        archive.append(nodeStream, { name: `image-${index + 1}.${ext}` });
      } catch (err) {
        console.error("[library/download] fetch failed", {
          url: img.imageUrl,
          err,
        });
      }
    }
    try {
      await archive.finalize();
    } catch (err) {
      console.error("[library/download] finalize failed", err);
    }
  })();

  const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  const filename = `uniqueme-library-${todayYyyyMmDd()}.zip`;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Pull the lowercase extension off a Blob URL's path. Returns null when
 * the path has no extension (e.g., a URL ending in `/`). Defensive on
 * malformed URLs — those return null too.
 */
function extensionFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").pop() ?? "";
    const dot = tail.lastIndexOf(".");
    if (dot < 0 || dot === tail.length - 1) return null;
    return tail.slice(dot + 1).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * `YYYY-MM-DD` in UTC. Used only for the suggested download filename, so
 * UTC is acceptable — the user won't notice if a 3am-local download is
 * labeled with tomorrow's date.
 */
function todayYyyyMmDd(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
