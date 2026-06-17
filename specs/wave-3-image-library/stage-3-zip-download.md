# Stage 3 — ZIP download endpoint

**Goal:** ship a streaming GET route that returns all of the user's library images as a single ZIP. Standalone and testable via `curl`; no UI in this stage.

Read `spec.md` first.

**Prereq:** Stages 1 + 2 committed and green.

---

## Files to touch

1. `package.json` — add `archiver` + `@types/archiver`
2. `src/app/api/library/download/route.ts` — NEW route handler

---

## Steps

### 1. Dependencies

```
pnpm add archiver
pnpm add -D @types/archiver
```

Use the current major version (likely v7 at time of writing). Confirm streaming API is available in the installed version.

### 2. Route handler

`src/app/api/library/download/route.ts` — new file. Outline:

```ts
import { NextRequest } from "next/server";
import { headers } from "next/headers";
import archiver from "archiver";
import { auth } from "@/lib/auth";
import { imageService } from "@/lib/services";

export async function GET(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const images = await imageService.listLibrary(session.user.id);
  if (images.length === 0) return new Response(null, { status: 204 });

  const archive = archiver("zip", { zlib: { level: 6 } });

  // Pipe each image into the archive as a stream.
  for (const [index, img] of images.entries()) {
    const response = await fetch(img.imageUrl);
    if (!response.ok || !response.body) continue;
    const ext = extensionFromUrl(img.imageUrl) ?? "png";
    archive.append(
      // Convert Web ReadableStream → Node Readable via Readable.fromWeb
      // (Node 18+). Implementer: verify with the installed Node version.
      require("node:stream").Readable.fromWeb(response.body),
      { name: `image-${index + 1}.${ext}` },
    );
  }

  // Finalize triggers the stream to flush remaining bytes.
  archive.finalize();

  const filename = `uniqueme-library-${todayYyyyMmDd()}.zip`;

  return new Response(
    require("node:stream").Readable.toWeb(archive) as ReadableStream,
    {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    },
  );
}

function extensionFromUrl(url: string): string | null {
  const u = new URL(url);
  const tail = u.pathname.split("/").pop() ?? "";
  const dot = tail.lastIndexOf(".");
  if (dot < 0 || dot === tail.length - 1) return null;
  return tail.slice(dot + 1).toLowerCase();
}

function todayYyyyMmDd(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
```

Notes for the implementer:
- `Readable.fromWeb` and `Readable.toWeb` are available on Node 18.17+ and 20+. Confirm.
- If `archiver` types complain about the stream type, cast through `unknown`. Keep the runtime call right.
- `extensionFromUrl` is a small helper; inline if you prefer, or extract. Both fine.
- Filename inside the ZIP is `image-N.ext`. No PII, no original UUID. Simple.

### 3. Error handling

- 401 if unauthenticated.
- 204 if the library is empty.
- Per-image fetch errors: log and skip (use `console.error("[library/download] fetch failed", { url, err })`). Continue archiving the rest. Don't fail the whole download because one blob 404'd.
- If `archiver` emits an error event mid-stream: log it (`archive.on("error", (err) => console.error("[library/download] archiver", err))`). The Response will likely be truncated at that point — acceptable; the browser will show a download error.

### 4. Cache-Control

Set `Cache-Control: no-store`. The user's library can change between downloads; we never want a CDN or browser to cache the ZIP.

---

## Acceptance criteria

1. `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` all pass.
2. `archiver` and `@types/archiver` appear in `package.json`.
3. `curl -i -b "<session-cookie>" http://localhost:3000/api/library/download -o test.zip` produces a valid ZIP for a logged-in user with library images. Unzip it; the expected images are inside, named `image-1.<ext>`, `image-2.<ext>`, etc.
4. `curl -i http://localhost:3000/api/library/download` (no cookie) returns 401.
5. A test user with 0 library images returns 204.
6. No Wave 1/2 regressions.

---

## Out of scope (DO NOT DO in this stage)

- Do NOT add the UI button that triggers the download — Stage 4.
- Do NOT add the "Delete after download" popup — Stage 4.
- Do NOT modify any other route handlers.
- Do NOT alter `imageService.listLibrary` — read-only consumer here.
- Do NOT implement a "prepare server-side then link" fallback — only build the streaming path.
- Do NOT add download analytics / telemetry.
