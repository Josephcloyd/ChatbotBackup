import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FLOWBOARD_AUTH_COOKIE, getSessionPayload, type SessionPayload } from "./flowboardAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

async function authError(message: string, status: number): Promise<NextResponse> {
  const response = NextResponse.json({ success: false, error: message }, { status });
  // ONLY clear cookie for 401 Unauthorized (session expired or invalid token)
  if (status === 401) {
    const cookieStore = await cookies();
    cookieStore.set(FLOWBOARD_AUTH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
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
    if (!response.ok || !data.success) {
      if (data.user?.active === false) {
        return authError("Account is inactive or unavailable.", 403);
      }
      // If server returned a temporary error, preserve cookie & fallback to validated session token
      return {
        ...session,
        role: session.role === "admin" ? "admin" : "operator",
      };
    }
    if (data.user?.active === false) {
      return authError("Account is inactive or unavailable.", 403);
    }
    return {
      ...session,
      id: data.user?.id ?? session.id,
      displayName: data.user?.displayName ?? session.displayName,
      role: data.user?.role === "admin" ? "admin" : "operator",
    };
  } catch {
    // If planner server is temporarily unreachable, fallback to validated session token without logging out user
    return {
      ...session,
      role: session.role === "admin" ? "admin" : "operator",
    };
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

export function sessionForwardHeaders(session: SessionPayload): HeadersInit {
  return {
    "x-flowboard-user-id": session.id ?? session.username,
    "x-flowboard-username": session.username,
    "x-flowboard-role": session.role,
  };
}
