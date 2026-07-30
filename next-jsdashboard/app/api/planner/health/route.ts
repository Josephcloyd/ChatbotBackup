import { NextResponse } from "next/server";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET() {
  try {
    const response = await fetch(`${plannerUrl}/health`, { cache: "no-store" });
    return NextResponse.json(await response.json(), {
      status: response.status,
    });
  } catch {
    return NextResponse.json({ status: "offline" }, { status: 503 });
  }
}
