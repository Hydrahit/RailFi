import { NextRequest, NextResponse } from "next/server";
import {
  addStoredUpiHandle,
} from "@/lib/offramp-store";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { validateTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Reject cross-origin UPI mutations before reading session cookies.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { upiId?: string } | null;
  const upiId = body?.upiId?.trim();
  if (!upiId) {
    return NextResponse.json({ error: "UPI ID is required." }, { status: 400 });
  }

  const handles = await addStoredUpiHandle(session.walletAddress, upiId);
  const response = NextResponse.json({ handles }, { status: 200 });
  return attachWalletSessionCookie(response, session.sessionId);
}
