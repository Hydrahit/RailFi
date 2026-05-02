import { NextRequest, NextResponse } from "next/server";
import { validateTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Compatibility UPI mutation route still enforces the shared CSRF origin guard.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  return NextResponse.json({ error: "Use /api/profile/upi for UPI mutations." }, { status: 404 });
}
