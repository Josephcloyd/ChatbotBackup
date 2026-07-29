import { NextResponse } from "next/server";
import { requireSession, sessionForwardHeaders } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; revisionId: string }> },
) {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const { id, revisionId } = await context.params;
    const response = await fetch(
      `${plannerUrl}/api/plans/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      {
        method: "POST",
        headers: sessionForwardHeaders(session),
        cache: "no-store",
        signal: AbortSignal.timeout(180_000),
      },
    );
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
