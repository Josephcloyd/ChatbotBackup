import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET(request: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const requestUrl = new URL(request.url);
    const response = await fetch(`${plannerUrl}/api/admin/runs?${requestUrl.searchParams.toString()}`, {
      cache: "no-store",
    });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Planner service unavailable" },
      { status: 503 },
    );
  }
}
