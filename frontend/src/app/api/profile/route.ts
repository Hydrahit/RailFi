import { NextRequest, NextResponse } from "next/server";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { getProfileSummary } from "@/lib/offramp-store";
import { validateTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getProfileSummary(session.walletAddress);
  const response = NextResponse.json(profile, { status: 200 });
  return attachWalletSessionCookie(response, session.sessionId);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Reject cross-origin profile mutations before session or storage access.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  return NextResponse.json({ error: "No profile mutation is supported on this route." }, { status: 405 });
}
