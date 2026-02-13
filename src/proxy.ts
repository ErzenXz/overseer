import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
const publicRoutes = ["/login", "/api/auth/login"];

// API routes that require authentication
const protectedApiRoutes = [
  "/api/providers",
  "/api/interfaces",
  "/api/soul",
  "/api/settings",
  "/api/auth/me",
  "/api/auth/logout",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if it's a public route
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get("overseer_session");

  // For API routes
  if (pathname.startsWith("/api/")) {
    if (protectedApiRoutes.some((route) => pathname.startsWith(route))) {
      if (!sessionCookie?.value) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }
    return NextResponse.next();
  }

  // For page routes (dashboard, etc.)
  if (!sessionCookie?.value) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
