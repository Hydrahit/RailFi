import { NextRequest, NextResponse } from "next/server";
import { getOfframpHistory, getWalletUsdcBalance } from "@/lib/helius-das";
import { getCompressedOfframpRequests } from "@/lib/light-rpc";
import { getWebhookRecordsByWallet } from "@/lib/webhook-store";
import {
  attachWalletSessionCookie,
  getWalletSessionFromRequest,
  touchWalletSession,
} from "@/lib/wallet-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const refreshed = await touchWalletSession(session.sessionId);
    if (!refreshed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [balance, transactions, compressionRecords, zkHistory] = await Promise.all([
      getWalletUsdcBalance(refreshed.walletAddress),
      getOfframpHistory(refreshed.walletAddress),
      getWebhookRecordsByWallet(refreshed.walletAddress),
      getCompressedOfframpRequests(refreshed.walletAddress),
    ]);

    const response = NextResponse.json(
      {
        walletAddress: refreshed.walletAddress,
        balance,
        transactions,
        compressionRecords,
        zkHistory,
      },
      { status: 200 },
    );
    return attachWalletSessionCookie(response, refreshed.sessionId);
  } catch (error) {
    console.error("[dashboard/wallet-intelligence] failed:", error);
    return NextResponse.json({ error: "Failed to load wallet dashboard data." }, { status: 500 });
  }
}
