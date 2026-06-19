import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Next.js 16 proxy (formerly `middleware`) — owns the auth + onboarding gate
 * for every authenticated surface in UniqueMe (Phase 1, spec § 1.5).
 *
 * Why cookie-based rather than DB-backed:
 *   Middleware runs at the edge and cannot reach the Postgres connection used
 *   by the rest of the app. We therefore make all gating decisions from
 *   request cookies. The decisions are intentionally optimistic — a forged
 *   `uniqueme:has-profile` cookie would only get the user past the gate to a
 *   page that does its own `auth.api.getSession()` + `profileService.hasProfile()`
 *   check (e.g. `/create` will redirect to `/onboarding` if the profile is
 *   actually missing). Server pages remain the source of truth; the cookie is
 *   a fast-path hint.
 *
 * Why we read the Better Auth cookie via `getSessionCookie` helper:
 *   Better Auth uses different cookie names depending on the environment
 *   (`better-auth.session_token` in dev, `__Secure-better-auth.session_token`
 *   in production behind HTTPS) and supports a configurable `cookiePrefix`.
 *   The helper resolves all of that for us in one call, so we don't have to
 *   maintain a hand-rolled allowlist of variants.
 */

/**
 * Routes that require an authenticated session. Order doesn't matter; we
 * check via `some()`. The `/onboarding` prefix is included here because
 * onboarding itself requires a logged-in user — unauthenticated visitors get
 * sent to `/login` before they ever see the form.
 */
const PROTECTED_PREFIXES = [
  "/create",
  "/schedule-posts",
  "/posting-soon",
  "/cancelled-posts",
  "/library",
  "/settings",
  "/onboarding",
] as const;

const AUTH_REDIRECT = "/login";
const ONBOARDING = "/onboarding";
const HOME = "/create";

/**
 * Cookie set by `saveOnboardingAction` after a successful profile save. Read
 * here (and only here) as the middleware-side proof of onboarding completion.
 * Kept in sync with DB reality by the onboarding action — see
 * `src/app/(app)/onboarding/actions.ts`.
 */
const HAS_PROFILE_COOKIE = "uniqueme:has-profile";

/**
 * Returns true if the request path is one of UniqueMe's authenticated routes.
 * We match by prefix (with a `/` boundary) rather than exact equality so that
 * child routes like `/settings/billing` are also gated without us having to
 * enumerate them.
 */
function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Returns true if the request path is the onboarding flow (the form page or
 * its `/done` success screen). Used to gate the "onboarded users shouldn't
 * see onboarding again" rule.
 */
function isOnboardingPath(pathname: string): boolean {
  return pathname === ONBOARDING || pathname.startsWith(`${ONBOARDING}/`);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Public routes (marketing, auth, API handlers, static assets) get the
  // fast-path. The `matcher` config below also filters most of these at the
  // routing layer, but the explicit guard here keeps the logic readable.
  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  // Step 1: require a session cookie. We don't validate the token here —
  // that's the page-level `auth.api.getSession()` job. A missing cookie is
  // an unambiguous "not signed in".
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL(AUTH_REDIRECT, request.url));
  }

  // Step 2: profile gate. The presence of the `uniqueme:has-profile=1` cookie
  // means the user completed onboarding on this device at least once. The
  // server pages re-validate against the DB on first render after sign-in,
  // so a stale or missing cookie self-heals on the next protected page hit.
  const hasProfile =
    request.cookies.get(HAS_PROFILE_COOKIE)?.value === "1";

  if (isOnboardingPath(pathname)) {
    // Onboarded users don't need to see the onboarding flow again. Bounce
    // them to the new home (`/create`) so the `(app)/onboarding/page.tsx`
    // server check doesn't have to do the redirect itself on every visit.
    if (hasProfile) {
      return NextResponse.redirect(new URL(HOME, request.url));
    }
    return NextResponse.next();
  }

  // Step 3: every other protected route requires a completed profile. Send
  // un-onboarded users back to the form.
  if (!hasProfile) {
    return NextResponse.redirect(new URL(ONBOARDING, request.url));
  }

  return NextResponse.next();
}

/**
 * Limit the proxy to authenticated surfaces. The matcher patterns mirror
 * `PROTECTED_PREFIXES` and intentionally cover children via the
 * `:path*` segment so e.g. `/settings/billing` is gated identically to
 * `/settings`.
 */
export const config = {
  matcher: [
    "/create/:path*",
    "/schedule-posts/:path*",
    "/posting-soon/:path*",
    "/cancelled-posts/:path*",
    "/library/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
};
