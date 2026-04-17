import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "@/lib/db";
import { verifyWalletSignature } from "@/lib/siws";
import { setProfileFlags } from "@/lib/offramp-store";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    walletAddress = requestedWalletAddress;
  }

  if (!walletAddress) {
    return NextResponse.json(
      { error: "Wallet session required. Connect your wallet before linking Google." },
      { status: 401 },
    );
  }

  await setProfileFlags(walletAddress, { googleLinked: true, walletLinked: true });
  if (process.env.DATABASE_URL) {
    await db.user.upsert({
      where: { email: session.user.email },
      update: {
        walletAddress,
        walletLinked: true,
        googleLinked: true,
      },
      create: {
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
        walletAddress,
        walletLinked: true,
        googleLinked: true,
      },
    });
  }

  return NextResponse.json({ linked: true }, { status: 200 });
}
