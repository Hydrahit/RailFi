import { NextRequest, NextResponse } from "next/server";
import { getInvoice } from "@/lib/invoice-store";
import { toPublicInvoiceRecord } from "@/types/invoice";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "invoicePublicReadIp",
    "Invoice link lookup rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  try {
    const invoice = await getInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (invoice.status === "EXPIRED") {
      return NextResponse.json(
        { error: "Invoice expired.", invoice: toPublicInvoiceRecord(invoice) },
        { status: 410 },
      );
    }

    return NextResponse.json(toPublicInvoiceRecord(invoice), { status: 200 });
  } catch (error) {
    console.error("[invoice] public fetch failed:", error);
    return NextResponse.json({ error: "Failed to load invoice." }, { status: 500 });
  }
}
