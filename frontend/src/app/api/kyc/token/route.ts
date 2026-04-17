import { NextRequest, NextResponse } from "next/server";
import {
  createAccessToken,
  isSumsubDemoMode,
  isSumsubUpstreamError,
} from "@/lib/sumsub";
import { setComplianceRecord } from "@/lib/compliance/store";
import { normalizeTier, type ComplianceTier } from "@/lib/compliance/types";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { enforceIpRateLimit, enforceWalletRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ipLimit = await enforceIpRateLimit(
    request,
    "kycTokenIp",
    "Too many KYC token requests. Please try again later.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  const walletLimit = await enforceWalletRateLimit(
    session.walletAddress,
    "kycTokenWallet",
    "KYC token rate limit exceeded for this wallet.",
  );
  if (!walletLimit.allowed) {
    return NextResponse.json({ error: walletLimit.message }, { status: 429 });
  }

  let body: { requiredTier?: ComplianceTier };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid KYC token payload." }, { status: 400 });
  }

  const requiredTier = normalizeTier(body.requiredTier);
  if (requiredTier === "NONE") {
    return NextResponse.json({ error: "KYC tier is not required for this quote." }, { status: 400 });
  }

  try {
    if (isSumsubDemoMode()) {
      const now = Math.floor(Date.now() / 1000);
      await setComplianceRecord(session.walletAddress, {
        requestedTier: requiredTier,
        approvedTier: "FULL",
        sumsubApplicantId: `demo-applicant:${session.walletAddress}`,
        reviewStatus: "demo_approved",
        status: "approved_ready",
        compressedAccountId: `demo-compressed:${session.walletAddress}`,
        leafIndex: 0,
        issuedAt: now,
        expiresAt: now + 31_536_000,
        proofReadyAt: now,
      });
      console.warn("[KYC Token] Running in Demo Mode, KYC bypassed.", {
        wallet: session.walletAddress,
        requiredTier,
      });
      const response = NextResponse.json({
        token: `demo-token:${session.walletAddress}:${requiredTier}`,
        applicantId: `demo-applicant:${session.walletAddress}`,
        requiredTier,
      });
      return attachWalletSessionCookie(response, session.sessionId);
    }

    const token = await createAccessToken(session.walletAddress, requiredTier);
    await setComplianceRecord(session.walletAddress, {
      requestedTier: requiredTier,
      sumsubApplicantId: token.userId,
      status: "pending_review",
    });

    const response = NextResponse.json({
      token: token.token,
      applicantId: token.userId,
      requiredTier,
    });
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    if (isSumsubUpstreamError(error)) {
      const upstreamError = error;
      console.error("[KYC Token] Sumsub upstream failure.", {
        wallet: session.walletAddress,
        requiredTier,
        message: upstreamError.message,
      });
      return NextResponse.json(
        { error: "Sumsub is temporarily unavailable." },
        { status: 502 },
      );
    }

    console.error("[KYC Token] Unexpected failure.", {
      wallet: session.walletAddress,
      requiredTier,
      error,
    });
    return NextResponse.json({ error: "Failed to create KYC access token." }, { status: 500 });
  }
}
