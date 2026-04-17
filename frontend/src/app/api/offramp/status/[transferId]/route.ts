import { NextRequest, NextResponse } from "next/server";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { getOfframpRecord } from "@/lib/offramp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { transferId: string } },
): Promise<NextResponse> {
  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const transferId = params.transferId?.trim();
  if (!transferId) {
    return NextResponse.json({ error: "Missing transferId." }, { status: 400 });
  }

  const record = await getOfframpRecord(transferId);
  if (!record) {
    return NextResponse.json({ error: "Offramp record not found." }, { status: 404 });
  }

  if (record.walletAddress !== session.walletAddress) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = NextResponse.json(
    {
      transferId: record.transferId,
      status: record.status,
      utr: record.utr,
      amountInr: record.amountInr,
      amountUsdc: record.amountUsdc,
      requiresReview: record.requiresReview,
      solanaTx: record.solanaTx,
      completedAt: record.completedAt,
    },
    { status: 200 },
  );

  return attachWalletSessionCookie(response, session.sessionId);
}
