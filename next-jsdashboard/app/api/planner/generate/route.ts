import { NextResponse } from "next/server";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const response = await fetch(`${plannerUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(600_000),
    });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planner service unavailable";
    const userFriendlyError =
      message === "fetch failed"
        ? `Cannot connect to MCP Planner server at ${plannerUrl}. Make sure mcp-server is running.`
        : message;
    return NextResponse.json(
      { success: false, error: userFriendlyError },
      { status: 503 },
    );
  }
}

