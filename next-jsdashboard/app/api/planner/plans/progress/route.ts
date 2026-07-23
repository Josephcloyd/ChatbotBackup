import { NextResponse } from "next/server";
import { requireSession, userForwardHeaders } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "Plan ID required" }, { status: 400 });
    }

    const body = await request.text();
    const response = await fetch(`${plannerUrl}/api/plans/${encodeURIComponent(id)}/progress`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...userForwardHeaders(session) },
      body,
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
