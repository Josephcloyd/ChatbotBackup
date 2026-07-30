import { NextResponse } from "next/server";
import { requireSession, sessionForwardHeaders } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const { id } = await context.params;
    const response = await fetch(
      `${plannerUrl}/api/plans/${encodeURIComponent(id)}/workspace`,
      {
        cache: "no-store",
        headers: sessionForwardHeaders(session),
      },
    );
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Planner service unavailable",
      },
      { status: 503 },
    );
  }
}
