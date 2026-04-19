import { NextRequest, NextResponse } from "next/server";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const walletSession = await getRefreshedWalletSessionFromRequest(request);
  if (!walletSession) {
    return NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { callbackUrl?: string } | null;
  const callbackUrl = body?.callbackUrl?.trim() || "/profile";
  const url = new URL("/api/auth/signin/google", request.url);
  url.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.json({ redirectUrl: url.toString() }, { status: 200 });
}
