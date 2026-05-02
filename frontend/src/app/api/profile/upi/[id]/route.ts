import { NextRequest, NextResponse } from "next/server";
import {
  removeStoredUpiHandle,
  setDefaultUpiHandle,
} from "@/lib/offramp-store";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { validateTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // SECURITY: Reject cross-origin UPI deletion before reading session cookies.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const handleId = params.id?.trim();
  if (!handleId) {
    return NextResponse.json({ error: "Handle ID is required." }, { status: 400 });
  }

  const handles = await removeStoredUpiHandle(session.walletAddress, handleId);
  const response = NextResponse.json({ handles }, { status: 200 });
  return attachWalletSessionCookie(response, session.sessionId);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  // SECURITY: Reject cross-origin default-UPI mutations before reading session cookies.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const handleId = params.id?.trim();
  if (!handleId) {
    return NextResponse.json({ error: "Handle ID is required." }, { status: 400 });
  }

  const handles = await setDefaultUpiHandle(session.walletAddress, handleId);
  const response = NextResponse.json({ handles }, { status: 200 });
  return attachWalletSessionCookie(response, session.sessionId);
}
