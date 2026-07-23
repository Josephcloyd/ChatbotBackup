import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FLOWBOARD_AUTH_COOKIE, getSessionPayload, type SessionPayload } from "./flowboardAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function requireSession(): Promise<SessionPayload | NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(FLOWBOARD_AUTH_COOKIE)?.value;
  const session = await getSessionPayload(token);

  if (!session) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }

  try {
    const response = await fetch(`${plannerUrl}/api/auth/status?username=${encodeURIComponent(session.username)}`, {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.success || data.user?.active === false) {
      return NextResponse.json({ success: false, error: "Account is inactive or unavailable." }, { status: 403 });
    }
    return {
      ...session,
      id: data.user?.id ?? session.id,
      role: data.user?.role === "admin" ? "admin" : "operator",
    };
  } catch {
    return NextResponse.json({ success: false, error: "Authentication service unavailable." }, { status: 503 });
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

export function userForwardHeaders(session: SessionPayload): HeadersInit {
  return {
    "x-flowboard-user-id": session.id ?? session.username,
    "x-flowboard-user-role": session.role,
  };
}
