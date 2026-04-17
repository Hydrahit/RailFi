import { NextRequest, NextResponse } from "next/server";
import { getInvoice } from "@/lib/invoice-store";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { enforceWalletRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  try {
    const session = await getRefreshedWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const walletLimit = await enforceWalletRateLimit(
      session.walletAddress,
      "invoicePayContextWallet",
      "Invoice checkout authorization rate limit exceeded for this wallet.",
    );
    if (!walletLimit.allowed) {
      return NextResponse.json({ error: walletLimit.message }, { status: 429 });
    }

    const invoice = await getInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (invoice.status === "EXPIRED") {
      return NextResponse.json({ error: "Invoice expired." }, { status: 410 });
    }

    if (invoice.status === "PAID") {
      return NextResponse.json({ error: "Invoice already paid." }, { status: 409 });
    }

    const response = NextResponse.json(
      { destinationUpiId: invoice.destinationUpiId },
      { status: 200 },
    );
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    console.error("[invoice-pay-context] failed:", error);
    return NextResponse.json({ error: "Failed to prepare invoice checkout." }, { status: 500 });
  }
}
