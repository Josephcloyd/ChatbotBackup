import { NextResponse } from "next/server";
import { requireSession } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid generation request." }, { status: 400 });
    }
    const payload = {
      ...body,
      whatsappUserId: session.username,
      generationSource: session.role === "admin" ? "admin" : "dashboard",
      requestedBy: session.id ?? session.username,
    };
    const response = await fetch(`${plannerUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(600_000),
    });
    const responsePayload = await response.text();
    return new NextResponse(responsePayload, {
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

