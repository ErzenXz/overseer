import { NextRequest, NextResponse } from "next/server";
import { login } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const result = await login(username, password);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      success: true,
      user: result.user,
    });

    // Only force Secure cookies when the request is actually HTTPS (or explicitly configured).
    // This prevents auth loops on self-hosted HTTP deployments running in production mode.
    const secureCookieOverride = process.env.AUTH_COOKIE_SECURE;
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const isHttps =
      request.nextUrl.protocol === "https:" ||
      (forwardedProto ? forwardedProto.split(",")[0]?.trim() === "https" : false);
    const secureCookie =
      typeof secureCookieOverride === "string"
        ? secureCookieOverride === "true"
        : isHttps;

    response.cookies.set("overseer_session", result.sessionId || "", {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}
