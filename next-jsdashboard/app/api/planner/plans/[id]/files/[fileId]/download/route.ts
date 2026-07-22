import { NextResponse } from "next/server";
import { adminForwardHeaders, requireAdmin } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function POST(_request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const { id, fileId } = await context.params;
    const response = await fetch(
      `${plannerUrl}/api/plans/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/download`,
      {
        method: "POST",
        headers: adminForwardHeaders(session),
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
