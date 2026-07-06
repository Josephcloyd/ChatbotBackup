import { NextResponse } from "next/server";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const userId = requestUrl.searchParams.get("userId");
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const response = await fetch(`${plannerUrl}/api/plans${query}`, { cache: "no-store" });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    return NextResponse.json(
      { configured: false, plans: [], error: error instanceof Error ? error.message : "Planner service unavailable" },
      { status: 503 },
    );
  }
}
