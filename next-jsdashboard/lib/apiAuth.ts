import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FLOWBOARD_AUTH_COOKIE, getSessionPayload, type SessionPayload } from "./flowboardAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

async function authError(message: string, status: number): Promise<NextResponse> {
  const response = NextResponse.json({ success: false, error: message }, { status });
  const cookieStore = await cookies();
  cookieStore.set(FLOWBOARD_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function requireSession(): Promise<SessionPayload | NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(FLOWBOARD_AUTH_COOKIE)?.value;
  const session = await getSessionPayload(token);

  if (!session) {
    return authError("Authentication required.", 401);
  }

  try {
    const response = await fetch(`${plannerUrl}/api/auth/status?username=${encodeURIComponent(session.username)}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.success || data.user?.active === false) {
      return authError("Account is inactive or unavailable.", 403);
    }
    return {
      ...session,
      id: data.user?.id ?? session.id,
      displayName: data.user?.displayName ?? session.displayName,
      role: data.user?.role === "admin" ? "admin" : "operator",
    };
  } catch {
    return authError("Authentication service unavailable.", 503);
  }
}

export async function requireAdmin(): Promise<SessionPayload | NextResponse> {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  if (session.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "Access denied. Administrator privileges required." },
      { status: 403 },
    );
  }

  return session;
}

export function adminForwardHeaders(session: SessionPayload): HeadersInit {
  return {
    "x-flowboard-admin-id": session.id ?? session.username,
  };
}
