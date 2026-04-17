import { NextRequest, NextResponse } from "next/server";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { getOfframpRecord } from "@/lib/offramp-store";
import { getPayoutStatus } from "@/services/cashfree/payout";

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

  const canonical = await getOfframpRecord(transferId);
  const record = canonical
    ? {
        walletAddress: canonical.walletAddress,
        status: canonical.status,
        utr: canonical.utr,
        amountInr: canonical.amountInr.toFixed(2),
      }
    : await getPayoutStatus(transferId);
  if (!record) {
    return NextResponse.json({ error: "Payout record not found." }, { status: 404 });
  }

  if (record.walletAddress !== session.walletAddress) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = NextResponse.json(
    {
      status: record.status,
      utr: record.utr,
      amountInr: record.amountInr,
    },
    { status: 200 },
  );
  return attachWalletSessionCookie(response, session.sessionId);
}
