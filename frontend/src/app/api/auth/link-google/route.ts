import { NextRequest, NextResponse } from "next/server";
import { signIn } from "../../../../../auth";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import { validateTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Reject cross-origin Google-link initiation before reading wallet-session cookies.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  const walletSession = await getRefreshedWalletSessionFromRequest(request);
  if (!walletSession) {
    return NextResponse.json({ error: "Wallet session required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { callbackUrl?: string } | null;
  const callbackUrl = body?.callbackUrl?.trim() || "/profile";
  const redirectUrl = await signIn("google", {
    redirect: false,
    redirectTo: callbackUrl,
  });
  return NextResponse.json({ redirectUrl: String(redirectUrl) }, { status: 200 });
}
