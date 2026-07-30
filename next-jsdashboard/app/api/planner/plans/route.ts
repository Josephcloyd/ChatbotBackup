import { NextResponse } from "next/server";
import {
  adminForwardHeaders,
  requireAdmin,
  requireSession,
} from "@/lib/apiAuth";

const plannerUrl = process.env.PLANNER_API_URL ?? "http://127.0.0.1:3001";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (session instanceof NextResponse) return session;

    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id");
    const download = requestUrl.searchParams.get("download");

    if (id && download === "true") {
      const response = await fetch(
        `${plannerUrl}/api/plans/${encodeURIComponent(id)}/download`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return new NextResponse(errorText, {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }

      const contentDisposition =
        response.headers.get("content-disposition") ??
        'attachment; filename="plan.xlsx"';
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          "content-type":
            response.headers.get("content-type") ??
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": contentDisposition,
        },
      });
    }

    const requestedUserId = requestUrl.searchParams.get("userId");
    const requestedLimit = requestUrl.searchParams.get("limit");
    const requestedOffset = requestUrl.searchParams.get("offset");
    const userId =
      session.role === "operator" ? session.username : requestedUserId;
    const params = new URLSearchParams();
    if (userId) params.set("userId", userId);
    if (requestedLimit) params.set("limit", requestedLimit);
    if (requestedOffset) params.set("offset", requestedOffset);
    const query = params.size ? `?${params.toString()}` : "";
    const response = await fetch(`${plannerUrl}/api/plans${query}`, {
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
        configured: false,
        plans: [],
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
        { success: false, error: "Plan ID required" },
        { status: 400 },
      );
    }

    const response = await fetch(
      `${plannerUrl}/api/plans/${encodeURIComponent(id)}`,
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

export async function PATCH(request: Request) {
  try {
    const session = await requireAdmin();
    if (session instanceof NextResponse) return session;

    const requestUrl = new URL(request.url);
    const id = requestUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Plan ID required" },
        { status: 400 },
      );
    }

    const body = await request.text();
    const response = await fetch(
      `${plannerUrl}/api/plans/${encodeURIComponent(id)}`,
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
