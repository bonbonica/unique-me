import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep sharp out of the webpack bundle so its native binary + libvips .so
  // load from node_modules at runtime. Without this the Vercel Lambda can
  // crash on cold start with ERR_DLOPEN_FAILED on libvips-cpp.so.
  serverExternalPackages: ["sharp"],

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },

  // Enable compression
  compress: true,

  /**
   * Legacy-URL redirects for the navigation redesign (Wave 1 task-05).
   * All permanent (308) — the URL changes are durable.
   *
   * Order matters: more specific paths first so a bare match doesn't
   * shadow the specific one (e.g. `/posts/currently-posting` must precede
   * the bare `/posts` rule).
   *
   * The `/posts?batchId=X → /schedule-posts/X` rule uses Next.js's `has`
   * clause with a named capture group `(?<id>.*)` referenced as `:id` in
   * the destination — preserves the batch id while flipping query→path.
   *
   * `/dashboard → /create` is included here per the navigation redesign's
   * locked decision (the sidebar already dropped its dashboard entry in
   * task-04). The dashboard page itself is deleted in Wave 3 task-08.
   */
  async redirects() {
    return [
      {
        source: "/posts/currently-posting",
        destination: "/posting-soon",
        permanent: true,
      },
      {
        source: "/posts",
        has: [{ type: "query", key: "batchId", value: "(?<id>.*)" }],
        destination: "/schedule-posts/:id",
        permanent: true,
      },
      {
        source: "/posts",
        destination: "/schedule-posts",
        permanent: true,
      },
      {
        source: "/schedule/:batchId",
        destination: "/posting-soon/:batchId",
        permanent: true,
      },
      {
        source: "/schedule",
        destination: "/posting-soon",
        permanent: true,
      },
      {
        source: "/dashboard",
        destination: "/create",
        permanent: true,
      },
    ];
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Content Security Policy. We allow 'unsafe-inline' for script-src
          // and style-src because Next.js App Router + React 19 emits inline
          // scripts for Flight streaming and inline styles for hydration that
          // we can't easily hash without a nonce. A nonce-based strict CSP
          // (set via middleware on every request and threaded through
          // <Script nonce={...}>) is future work — once that lands we can
          // drop 'unsafe-inline' from both directives.
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; img-src 'self' blob: data: https://*.public.blob.vercel-storage.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
