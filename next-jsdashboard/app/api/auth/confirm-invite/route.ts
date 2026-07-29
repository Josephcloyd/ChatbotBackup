import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, FLOWBOARD_AUTH_COOKIE } from "@/lib/flowboardAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
  const temporaryPassword = typeof body?.temporaryPassword === "string" ? body.temporaryPassword.trim() : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword.trim() : "";

  if (!identifier || !temporaryPassword || !newPassword) {
    return NextResponse.json(
      { success: false, error: "Email/username, temporary password, and new password are required." },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(`${plannerUrl}/api/auth/confirm-invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, temporaryPassword, newPassword }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return NextResponse.json(
        { success: false, error: data.error ?? "Failed to confirm invitation and set new password." },
        { status: res.status },
      );
    }

    const { id, username: validUser, displayName, role } = data.user;
    const token = await createSessionToken(validUser, role, id, displayName);
    const cookieStore = await cookies();

    cookieStore.set(FLOWBOARD_AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 8,
    });

    return NextResponse.json({ success: true, user: { username: validUser, displayName, role } });
  } catch (err) {
    console.error("[confirm-invite/route] Error:", err);
    return NextResponse.json(
      { success: false, error: "Authentication service unavailable." },
      { status: 503 },
    );
  }
}
