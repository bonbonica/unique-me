import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
            key: "X-XSS-Protection",
            value: "1; mode=block",
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
