import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, FLOWBOARD_AUTH_COOKIE } from "@/lib/flowboardAuth";

export async function POST(request: Request) {
  const expectedPassword = process.env.FLOWBOARD_ACCESS_PASSWORD;

  if (!expectedPassword) {
    return NextResponse.json(
      { success: false, error: "FLOWBOARD_ACCESS_PASSWORD is not configured." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (password !== expectedPassword) {
    return NextResponse.json(
      { success: false, error: "Invalid password." },
      { status: 401 },
    );
  }

  const token = await createSessionToken();
  const cookieStore = await cookies();

  cookieStore.set(FLOWBOARD_AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return NextResponse.json({ success: true });
}
