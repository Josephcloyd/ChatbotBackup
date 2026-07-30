import { NextResponse } from "next/server";
import { adminForwardHeaders, requireAdmin } from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET() {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const response = await fetch(`${plannerUrl}/api/operators`, {
      cache: "no-store",
    });
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

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const body = await request.text();
    const response = await fetch(`${plannerUrl}/api/operators`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminForwardHeaders(session),
      },
      body,
    });
    const payload = await response.text();
    return new NextResponse(payload, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    console.error("[api/planner/operators] Error in POST:", error);
    const rawError =
      error instanceof Error ? error.message : "Planner service unavailable";
    const userFacingError =
      rawError === "fetch failed"
        ? "Unable to connect to the backend Planner service. Please ensure mcp-server is running."
        : rawError;
    return NextResponse.json(
      { success: false, error: userFacingError },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Operator ID required" },
        { status: 400 },
      );
    }

    const body = await request.text();
    const response = await fetch(
      `${plannerUrl}/api/operators/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...adminForwardHeaders(session),
        },
        body,
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

export async function DELETE(request: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Operator ID required" },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${plannerUrl}/api/operators/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: adminForwardHeaders(session),
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
