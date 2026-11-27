import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

type Context = {
  params: Promise<{ path: string[] }>;
};

const BASE_URL = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";

async function handler(request: NextRequest, { params }: Context) {
  const { userId, getToken } = await auth();

  if (!userId) {
    return NextResponse.json({ detail: "Sign in required" }, { status: 401 });
  }

  const { path } = await params;

  if (
    !path.length ||
    ![
      "enquiries",
      "reservations",
      "auth",
      "hotels",
      "hotel-access",
      "staff",
    ].includes(path[0])
  ) {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }

  const target = new URL(
    `/api/v1/${path.map(encodeURIComponent).join("/")}`,
    BASE_URL,
  );

  target.search = request.nextUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  const token = await getToken();

  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });

    return new NextResponse(
      response.status === 204 ? null : await response.arrayBuffer(),
      {
        status: response.status,
        headers: {
          "content-type":
            response.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { detail: "Backend unavailable" },
      { status: 502 },
    );
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PATCH,
  handler as DELETE,
  handler as PUT,
};
