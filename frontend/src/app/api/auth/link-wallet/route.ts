import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { atomicLinkWallet } from "@/lib/atomic-operations";
import { verifyWalletSignature } from "@/lib/siws";
import { setProfileFlags } from "@/lib/offramp-store";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import { validateTrustedOrigin } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Reject cross-origin account-linking attempts before session or database access.
  if (!validateTrustedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden: invalid request origin" }, { status: 403 });
  }

  const [session, walletSession] = await Promise.all([
    auth(),
    getRefreshedWalletSessionFromRequest(request),
  ]);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Google session required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    walletAddress?: string;
    message?: string;
    signature?: string;
  } | null;

  const requestedWalletAddress = body?.walletAddress?.trim() ?? "";
  const message = body?.message?.trim() ?? "";
  const signature = body?.signature?.trim() ?? "";

  let walletAddress = walletSession?.walletAddress ?? null;

  if (requestedWalletAddress || message || signature) {
    if (!requestedWalletAddress || !message || !signature) {
      return NextResponse.json({ error: "Wallet signature payload is required." }, { status: 400 });
    }

    if (!verifyWalletSignature(requestedWalletAddress, message, signature)) {
      return NextResponse.json({ error: "Invalid wallet signature." }, { status: 401 });
    }

    try {
      const parsedMessage = JSON.parse(message) as { issuedAt?: unknown };
      const issuedAtValue = parsedMessage.issuedAt;
      const issuedAtTimestamp =
        typeof issuedAtValue === "string"
          ? Date.parse(issuedAtValue)
          : typeof issuedAtValue === "number"
            ? issuedAtValue
            : Number.NaN;

      if (
        Number.isFinite(issuedAtTimestamp) &&
        Date.now() - issuedAtTimestamp > 5 * 60 * 1000
      ) {
        return NextResponse.json(
          { error: "Signature expired. Please sign again." },
          { status: 401 },
        );
      }
    } catch {
      // Backward compatibility: allow legacy non-JSON messages.
    }

    walletAddress = requestedWalletAddress;
  }

  if (!walletAddress) {
    return NextResponse.json(
      { error: "Wallet session required. Connect your wallet before linking Google." },
      { status: 401 },
    );
  }

  if (process.env.DATABASE_URL) {
    if (!session.user.id) {
      return NextResponse.json({ error: "Authenticated user is missing an ID." }, { status: 500 });
    }

    const result = await atomicLinkWallet({
      userId: session.user.id,
      walletAddress,
      performedBy: `user:${session.user.email ?? session.user.id}`,
    });

    if (!result.ok) {
      if (result.reason === "wallet_taken") {
        return NextResponse.json(
          { error: "This wallet is already linked to another account" },
          { status: 409 },
        );
      }

      return NextResponse.json({ error: "Failed to link wallet" }, { status: 500 });
    }
  }

  // SECURITY: Profile trust flags are set only after the database link operation succeeds.
  await setProfileFlags(walletAddress, { googleLinked: true, walletLinked: true });

  return NextResponse.json({ ok: true }, { status: 200 });
}
