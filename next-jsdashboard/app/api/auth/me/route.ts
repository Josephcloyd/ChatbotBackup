import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSessionPayload, FLOWBOARD_AUTH_COOKIE } from "@/lib/flowboardAuth";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(FLOWBOARD_AUTH_COOKIE)?.value;
  const payload = await getSessionPayload(token);

  if (!payload) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({ success: true, user: payload });
}
