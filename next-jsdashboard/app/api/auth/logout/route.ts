import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FLOWBOARD_AUTH_COOKIE } from "@/lib/flowboardAuth";

export async function POST() {
  const cookieStore = await cookies();

  cookieStore.set(FLOWBOARD_AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return NextResponse.json({ success: true });
}
