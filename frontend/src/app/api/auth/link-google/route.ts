import { NextRequest, NextResponse } from "next/server";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import { setProfileFlags } from "@/lib/offramp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const walletSession = await getRefreshedWalletSessionFromRequest(request);
  if (!walletSession) {
    return NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  await setProfileFlags(walletSession.walletAddress, { walletLinked: true });

  const url = new URL("/api/auth/signin/google", request.url);
  url.searchParams.set("callbackUrl", "/profile");
  return NextResponse.json({ redirectUrl: url.toString() }, { status: 200 });
}
