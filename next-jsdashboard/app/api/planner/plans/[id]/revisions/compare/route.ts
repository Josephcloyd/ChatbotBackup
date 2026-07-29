import { NextResponse } from "next/server";
import { requireSession, sessionForwardHeaders } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const { id } = await context.params;
    const requestUrl = new URL(request.url);
    const from = requestUrl.searchParams.get("from") ?? "";
    const to = requestUrl.searchParams.get("to") ?? "";
    const query = new URLSearchParams({ from, to }).toString();
    const response = await fetch(`${plannerUrl}/api/plans/${encodeURIComponent(id)}/revisions/compare?${query}`, {
      headers: sessionForwardHeaders(session),
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
