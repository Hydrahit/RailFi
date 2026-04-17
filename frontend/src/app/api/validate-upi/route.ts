import { NextRequest, NextResponse } from "next/server";
import type { UpiValidationResponse } from "@/types/railpay";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const KNOWN_HANDLES: Record<string, { bank: string }> = {
  okaxis: { bank: "Axis Bank" },
  okhdfcbank: { bank: "HDFC Bank" },
  oksbi: { bank: "State Bank of India" },
  okicici: { bank: "ICICI Bank" },
  paytm: { bank: "Paytm Payments Bank" },
  ybl: { bank: "Yes Bank (PhonePe)" },
  ibl: { bank: "IDFC First Bank" },
  axl: { bank: "Axis Bank" },
  upi: { bank: "BHIM UPI" },
  apl: { bank: "Amazon Pay" },
  waicici: { bank: "ICICI Bank" },
  jpmc: { bank: "J.P. Morgan" },
};

const UPI_REGEX = /^[a-zA-Z0-9._-]{2,32}@[a-zA-Z]{2,32}$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    req,
    "validateUpiIp",
    "UPI validation rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  const vpa = req.nextUrl.searchParams.get("vpa")?.trim().toLowerCase();

  if (!vpa) {
    return NextResponse.json<UpiValidationResponse>(
      { isValid: false, vpa: "", error: "Missing vpa parameter" },
      { status: 400 },
    );
  }

  if (!UPI_REGEX.test(vpa)) {
    return NextResponse.json<UpiValidationResponse>(
      {
        isValid: false,
        vpa,
        error: "Invalid UPI ID format",
      },
      { status: 400 },
    );
  }

  const handle = vpa.split("@")[1] ?? "";
  const known = KNOWN_HANDLES[handle];

  if (known) {
    return NextResponse.json<UpiValidationResponse>({
      isValid: true,
      vpa,
      bank: known.bank,
    });
  }

  return NextResponse.json<UpiValidationResponse>(
    {
      isValid: false,
      vpa,
      error: "UPI ID could not be verified",
    },
    { status: 404 },
  );
}
