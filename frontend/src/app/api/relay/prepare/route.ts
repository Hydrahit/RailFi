import { NextRequest, NextResponse } from "next/server";
import { buildPreparedRelayTransaction } from "@/lib/relayer/builders";
import { isRelayEnabled } from "@/lib/relayer/keypair";
import { validateRelayRequest } from "@/lib/relayer/policy";
import type { RelayAction, RelayPrepareResponse } from "@/lib/relayer/types";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";
import { stagePreparedPayout } from "@/services/cashfree/payout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  if (!isRelayEnabled()) {
    return NextResponse.json(
      { error: "Gasless relayer is not configured." },
      { status: 503 },
    );
  }

  const ipLimit = await enforceIpRateLimit(
    request,
    "relayPrepareIp",
    "Rate limit exceeded — relay preparation capped per IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  let action: RelayAction;
  try {
    ({ action } = (await request.json()) as { action: RelayAction });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const prepared = await buildPreparedRelayTransaction(action);
    const policy = await validateRelayRequest(prepared.transaction, false);
    if (!policy.allowed) {
      return NextResponse.json({ error: policy.reason }, { status: 403 });
    }

    const body: RelayPrepareResponse = {
      serializedTransaction: Buffer.from(
        prepared.transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      ).toString("base64"),
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    };

    if (action.kind === "trigger_offramp") {
      await stagePreparedPayout(body.serializedTransaction, {
        walletAddress: action.userPubkey,
        upiId: action.upiId,
        amountMicroUsdc: action.amountMicroUsdc,
        inrPaise: action.inrPaise,
        referralPubkey: action.referralPubkey ?? null,
      });
    }

    return NextResponse.json(body);
  } catch (error) {
    console.error("[RELAY PREPARE ERROR]:", {
      action,
      error,
    });
    return NextResponse.json({ error: "Failed to prepare relay transaction." }, { status: 400 });
  }
}
