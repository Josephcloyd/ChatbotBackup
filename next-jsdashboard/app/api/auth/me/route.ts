import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ success: true, user: session });
}
