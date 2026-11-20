import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Optimistic gate: send signed-out visitors to /login. Data access re-checks the session (lib/api.ts).
export async function proxy(req: NextRequest) {
  const signedIn = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const onLogin = req.nextUrl.pathname === "/login";

  if (!signedIn && !onLogin) {
    const url = new URL("/login", req.url);
    const next = req.nextUrl.pathname + req.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  if (signedIn && onLogin) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
