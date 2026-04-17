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
  const googleSessionActive = !!nextAuthSession?.user?.email;
  const walletSessionAuthenticated = !!walletSession?.walletAddress;
  const googleLinked = !!(nextAuthSession?.user?.googleLinked ?? flags.googleLinked);
  const walletLinked = !!(
    nextAuthSession?.user?.walletLinked ??
    flags.walletLinked ??
    walletSessionAuthenticated
  );
  const identityBound = googleSessionActive && !!walletAddress && googleLinked && walletLinked;

  return NextResponse.json(
    {
      googleLinked,
      walletLinked,
      walletAddress,
      kycTier:
        nextAuthSession?.user?.kycTier ??
        (compliance?.approvedTier === "FULL" ? 3 : compliance?.approvedTier === "LITE" ? 1 : 0),
      googleSessionActive,
      walletSessionAuthenticated,
      nextAuthWalletAddress: nextAuthSession?.user?.walletAddress ?? null,
      identityBound,
    },
    { status: 200 },
  );
}
