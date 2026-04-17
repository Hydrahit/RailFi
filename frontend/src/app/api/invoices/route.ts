import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { createInvoice, getInvoicesByCreator } from "@/lib/invoice-store";
import { isValidUpiFormat } from "@/features/offramp/utils/upi-validation";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { enforceIpRateLimit, enforceWalletRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateInvoiceBody {
  amount?: number;
  description?: string;
  destinationUpiId?: string;
  expiresAt?: number | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  try {
    const session = await getRefreshedWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ipLimit = await enforceIpRateLimit(
      request,
      "invoiceCreateIp",
      "Too many invoice creation requests. Please try again later.",
    );
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: ipLimit.message }, { status: 429 });
    }

    const walletLimit = await enforceWalletRateLimit(
      session.walletAddress,
      "invoiceCreateWallet",
      "Invoice creation rate limit exceeded for this wallet.",
    );
    if (!walletLimit.allowed) {
      return NextResponse.json({ error: walletLimit.message }, { status: 429 });
    }

    const body = (await request.json()) as CreateInvoiceBody;
    const amount = Number(body.amount);
    const description = body.description?.trim() ?? "";
    const destinationUpiId = body.destinationUpiId?.trim().toLowerCase() ?? "";
    const expiresAt =
      body.expiresAt === null || body.expiresAt === undefined ? null : Number(body.expiresAt);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Amount must be greater than zero." }, { status: 400 });
    }

    if (description.length > 120) {
      return NextResponse.json({ error: "Description must be 120 characters or fewer." }, { status: 400 });
    }

    if (!isValidUpiFormat(destinationUpiId)) {
      return NextResponse.json({ error: "A valid destination UPI ID is required." }, { status: 400 });
    }

    if (expiresAt !== null) {
      if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
        return NextResponse.json({ error: "Expiry must be a future Unix timestamp." }, { status: 400 });
      }
    }

    const invoice = await createInvoice(nanoid(12), {
      creatorWallet: session.walletAddress,
      amount,
      description,
      destinationUpiId,
      expiresAt,
    });

    const response = NextResponse.json(invoice, { status: 201 });
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    console.error("[invoices] create failed:", error);
    return NextResponse.json({ error: "Failed to create invoice." }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getRefreshedWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const walletLimit = await enforceWalletRateLimit(
      session.walletAddress,
      "invoiceListWallet",
      "Invoice list rate limit exceeded for this wallet.",
    );
    if (!walletLimit.allowed) {
      return NextResponse.json({ error: walletLimit.message }, { status: 429 });
    }

    const invoices = await getInvoicesByCreator(session.walletAddress);
    const response = NextResponse.json({ invoices }, { status: 200 });
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    console.error("[invoices] list failed:", error);
    return NextResponse.json({ error: "Failed to load invoices." }, { status: 500 });
  }
}
