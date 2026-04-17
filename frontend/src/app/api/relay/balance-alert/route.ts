import { NextRequest, NextResponse } from "next/server";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "relayBalanceAlertIp",
    "Relayer alert rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  const configuredSecret = process.env.HELIUS_WEBHOOK_SECRET?.trim();
  const authHeader = request.headers.get("Authorization");

  if (!configuredSecret) {
    console.error("[relay/balance-alert] HELIUS_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook authentication is not configured." }, { status: 503 });
  }

  if (authHeader !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  console.error("[RELAYER ALERT] Low SOL balance:", body);
  return NextResponse.json({ received: true });
}
