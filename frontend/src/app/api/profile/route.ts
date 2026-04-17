import { NextRequest, NextResponse } from "next/server";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { getProfileSummary } from "@/lib/offramp-store";

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
