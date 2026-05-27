import "server-only";

import { cookies } from "next/headers";

export const HAS_PROFILE_COOKIE = "uniqueme:has-profile";

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

export async function setHasProfileCookie() {
  const store = await cookies();
  store.set(HAS_PROFILE_COOKIE, "1", {
    ...BASE_COOKIE_OPTIONS,
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearHasProfileCookie() {
  const store = await cookies();
  store.set(HAS_PROFILE_COOKIE, "", {
    ...BASE_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
