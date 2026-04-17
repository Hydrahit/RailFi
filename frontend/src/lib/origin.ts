import "server-only";

import type { NextRequest, NextResponse } from "next/server";

const DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

export function isTrustedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) {
    try {
      if (origin === new URL(configuredOrigin).origin) {
        return true;
      }
    } catch {
      // Ignore malformed env values here; startup/env validation is handled elsewhere.
    }
  }

  return process.env.NODE_ENV !== "production" && DEV_ORIGINS.has(origin);
}

function getRequestOrigin(request: NextRequest): string | null {
  const directOrigin = request.nextUrl?.origin?.trim();
  if (directOrigin) {
    return directOrigin;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim() || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host) {
    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    return `${proto}://${host}`;
  }

  return null;
}

export function requireTrustedOrigin(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin")?.trim() ?? null;
  const requestOrigin = getRequestOrigin(request);
  if (!isTrustedOrigin(origin) && (!origin || !requestOrigin || origin !== requestOrigin)) {
    return Response.json({ error: "Origin not allowed." }, { status: 403 }) as NextResponse;
  }

  return null;
}
