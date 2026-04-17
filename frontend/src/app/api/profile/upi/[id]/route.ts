import { NextRequest, NextResponse } from "next/server";
import {
  removeStoredUpiHandle,
  setDefaultUpiHandle,
} from "@/lib/offramp-store";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
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
