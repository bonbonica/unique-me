import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  clearHasProfileCookie,
  setHasProfileCookie,
} from "@/lib/profile/cookie";
import { profileService } from "@/lib/services";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("to");
  const safeTarget =
    target && target.startsWith("/") && !target.startsWith("//")
      ? target
      : "/create";

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const has = await profileService.hasProfile(session.user.id);
  if (has) {
    await setHasProfileCookie();
  } else {
    await clearHasProfileCookie();
  }

  return NextResponse.redirect(new URL(safeTarget, request.url));
}
