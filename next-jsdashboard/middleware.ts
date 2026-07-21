import { NextRequest, NextResponse } from "next/server";
import { FLOWBOARD_AUTH_COOKIE, getSessionPayload } from "@/lib/flowboardAuth";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(FLOWBOARD_AUTH_COOKIE)?.value;
  const session = await getSessionPayload(token);
  const hasValidSession = session !== null;

  if (pathname === "/login") {
    if (hasValidSession) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (hasValidSession) {
    // Restrict Admin APIs
    if (
      (pathname.startsWith("/api/operators") ||
        (pathname.startsWith("/api/plans") && ["DELETE", "PATCH"].includes(request.method))) &&
      session.role !== "admin"
    ) {
      return NextResponse.json(
        { success: false, error: "Access denied. Administrator privileges required." },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

