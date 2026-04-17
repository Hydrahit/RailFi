import { NextRequest } from "next/server";
import { auth } from "../../../../../../auth";
import { getOfframpRecord } from "@/lib/offramp-store";
import { getServerRedis } from "@/lib/upstash";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import type { DodoOfframpIntent } from "@/types/dodo";

export const runtime = "nodejs";

function getRedis() {
  return getServerRedis("dodo status");
}

export async function GET(
  request: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
  const [session, walletSession] = await Promise.all([
    auth(),
    getRefreshedWalletSessionFromRequest(request),
  ]);

  if (!session?.user?.email && !walletSession?.walletAddress) {
    return new Response("Unauthorized", { status: 401 });
  }

  const paymentId = params.paymentId?.trim();

  if (!paymentId) {
    return Response.json({ error: "paymentId is required" }, { status: 400 });
  }

  const intent = await getRedis().get<DodoOfframpIntent>(`railfi:dodo:intent:${paymentId}`);

  if (!intent) {
    return Response.json({ error: "Payment intent not found." }, { status: 404 });
  }

  const sessionEmail = session?.user?.email?.toLowerCase() ?? null;
  const intentEmail = intent.customerEmail.toLowerCase();
  const intentWallet = intent.walletAddress?.toLowerCase();
  const sessionWallet =
    session?.user?.walletAddress?.toLowerCase() ??
    walletSession?.walletAddress?.toLowerCase() ??
    null;
  const isOwner =
    (!!sessionEmail && sessionEmail === intentEmail) ||
    (!!intentWallet && !!sessionWallet && intentWallet === sessionWallet);

  if (!isOwner) {
    return new Response("Forbidden", { status: 403 });
  }

  const offrampRecord =
    typeof intent.transferId === "string" && intent.transferId.trim() !== ""
      ? await getOfframpRecord(intent.transferId)
      : null;

  return Response.json({
    dodoPaymentId: intent.dodoPaymentId,
    status: intent.status,
    amountUsd: intent.amountUsd,
    usdcAmount: intent.usdcAmount ?? null,
    transferId: intent.transferId ?? null,
    solanaTx: intent.solanaTx ?? null,
    createdAt: intent.createdAt,
    claimedAt: intent.claimedAt ?? null,
    executedAt: intent.executedAt ?? null,
    offrampStatus: offrampRecord?.status ?? null,
    utr: offrampRecord?.utr ?? null,
    requiresReview: offrampRecord?.requiresReview ?? null,
    completedAt: offrampRecord?.completedAt ?? null,
  });
}
