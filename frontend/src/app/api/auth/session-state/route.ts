import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import { getComplianceRecord } from "@/lib/compliance/store";
import { getProfileFlags } from "@/lib/offramp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const [nextAuthSession, walletSession] = await Promise.all([
    auth(),
    getRefreshedWalletSessionFromRequest(request),
  ]);

  const walletAddress = nextAuthSession?.user?.walletAddress ?? walletSession?.walletAddress ?? null;
  const compliance = walletAddress ? await getComplianceRecord(walletAddress) : null;
  const flags = walletAddress
    ? await getProfileFlags(walletAddress)
    : { googleLinked: !!nextAuthSession?.user?.googleLinked, walletLinked: false };

  return NextResponse.json(
    {
      googleLinked: nextAuthSession?.user?.googleLinked ?? flags.googleLinked,
      walletLinked: (nextAuthSession?.user?.walletLinked ?? !!walletAddress) || flags.walletLinked,
      walletAddress,
      kycTier: nextAuthSession?.user?.kycTier ?? (compliance?.approvedTier === "FULL" ? 3 : compliance?.approvedTier === "LITE" ? 1 : 0),
    },
    { status: 200 },
  );
}
