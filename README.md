# UniqueMe

AI social-media post generator and auto-poster for small business owners. Tell us about your business, answer two weekly questions, and UniqueMe creates and schedules a week of posts to Facebook, Instagram, and LinkedIn.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- PostgreSQL via Drizzle ORM
- Better Auth (Google OAuth — sole sign-in method)
- Anthropic Claude Sonnet for post generation
- OpenAI gpt-image-1 for image generation
- Firecrawl for website analysis
- Vercel Blob for image storage
- Tailwind CSS v4 + shadcn/ui (dark luxury theme)

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- PostgreSQL 14+ (local or hosted)

## Local development

1. Clone the repo and install dependencies:

   ```bash
   pnpm install
   ```

2. Copy `.env.example` to `.env.local` and fill in:

   - `POSTGRES_URL` — your Postgres connection string
   - `BETTER_AUTH_SECRET` — random 32-byte string (`openssl rand -base64 32`)
   - `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` locally
   - `ANTHROPIC_API_KEY` — Anthropic console
   - `OPENAI_API_KEY` — OpenAI dashboard
   - `FIRECRAWL_API_KEY` — Firecrawl dashboard
   - `ENCRYPTION_KEY` — 32-byte base64 string (`openssl rand -base64 32`)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Cloud Console (required — Google is the only sign-in method)
   - `BLOB_READ_WRITE_TOKEN` — Vercel Blob (optional locally, required in prod)

3. Generate and run database migrations:

   ```bash
   pnpm db:generate
   pnpm db:migrate
   ```

4. Start the dev server:

   ```bash
   pnpm dev
   ```

   Visit `http://localhost:3000`.

## Deployment

UniqueMe is built for Vercel. Connect the repo, set all env vars in the project settings, and deploy. The `build` script runs `db:migrate` before `next build` automatically.

## Project docs

- `AGENTS.md` — instructions for AI agents working on this codebase
- `DESIGN.md` — design system (colors, typography, components, layout patterns)
- `CLAUDE.md` — Claude-specific instructions (delegates to AGENTS.md)

## License

UniqueMe is source-available under the [Functional Source License, Version 1.1, ALv2 Future License](./LICENSE.md) (FSL-1.1-ALv2).

You may read, fork, and modify the source for any Permitted Purpose — internal business use, professional services on someone else's behalf, and non-commercial use are all allowed. You may not use it to provide a product or service that competes with UniqueMe.

Two years after each release, that release automatically converts to Apache 2.0.

© 2026 BonBonica LLC.
