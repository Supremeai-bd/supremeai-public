import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminAuthConfigured,
  createAdminSessionCookieValue,
  hasAdminSession,
  verifyAdminAccessToken,
} from "@/lib/admin-security";

export const dynamic = "force-dynamic";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  return noStore(
    NextResponse.json({
      configured: adminAuthConfigured(),
      authenticated: hasAdminSession(request),
      sessionHours: ADMIN_SESSION_TTL_SECONDS / 3600,
    }),
  );
}

export async function POST(request: NextRequest) {
  if (!adminAuthConfigured()) {
    return noStore(
      NextResponse.json(
        { error: "Owner access is not configured. Set a 32-character ADMIN_ACCESS_TOKEN." },
        { status: 503 },
      ),
    );
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!verifyAdminAccessToken(token)) {
    return noStore(NextResponse.json({ error: "Access token was not accepted." }, { status: 401 }));
  }

  const cookieValue = createAdminSessionCookieValue();
  if (!cookieValue) {
    return noStore(NextResponse.json({ error: "Owner access is unavailable." }, { status: 503 }));
  }

  const response = NextResponse.json({ authenticated: true, expiresInHours: 8 });
  response.cookies.set(ADMIN_SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return noStore(response);
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return noStore(response);
}
