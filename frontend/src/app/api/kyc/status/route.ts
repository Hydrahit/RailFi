import { NextRequest, NextResponse } from "next/server";
import {
  getApplicantByExternalId,
  isSumsubDemoMode,
  isSumsubUpstreamError,
} from "@/lib/sumsub";
import { getComplianceRecord, setComplianceRecord } from "@/lib/compliance/store";
import {
  normalizeTier,
  tierSatisfiesRequirement,
  type KycStatusResponse,
} from "@/lib/compliance/types";
import { isValidityProofReady } from "@/lib/compliance/attester";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { enforceWalletRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildDemoComplianceRecord(
  walletAddress: string,
  requiredTier: ReturnType<typeof normalizeTier>,
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    walletAddress,
    requestedTier: requiredTier === "NONE" ? "FULL" : requiredTier,
    approvedTier: "FULL" as const,
    sumsubApplicantId: `demo-applicant:${walletAddress}`,
    reviewStatus: "demo_approved",
    status: "approved_ready" as const,
    compressedAccountId: `demo-compressed:${walletAddress}`,
    leafIndex: 0,
    issuedAt: now,
    expiresAt: now + 31_536_000,
    proofReadyAt: now,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requiredTier = normalizeTier(request.nextUrl.searchParams.get("requiredTier"));

  try {
    const session = await getRefreshedWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const wallet = session.walletAddress;
    const walletLimit = await enforceWalletRateLimit(
      wallet,
      "kycStatusWallet",
      "KYC status polling limit exceeded for this wallet.",
    );
    if (!walletLimit.allowed) {
      return NextResponse.json({ error: walletLimit.message }, { status: 429 });
    }

    if (isSumsubDemoMode()) {
      const demoRecord = await setComplianceRecord(
        wallet,
        buildDemoComplianceRecord(wallet, requiredTier),
      );

      const body: KycStatusResponse = {
        walletAddress: wallet,
        requiredTier,
        approvedTier: "FULL",
        status: "approved_ready",
        meetsRequirement: true,
        outOfPolicy: false,
        compressedAccountId: demoRecord.compressedAccountId,
        leafIndex: demoRecord.leafIndex,
        expiresAt: demoRecord.expiresAt,
        message: "Demo mode: KYC bypassed.",
      };

      const response = NextResponse.json(body, { status: 200 });
      return attachWalletSessionCookie(response, session.sessionId);
    }

    const [applicant, record] = await Promise.all([
      getApplicantByExternalId(wallet),
      getComplianceRecord(wallet),
    ]);
    const reviewStatus =
      applicant?.review?.reviewStatus?.toLowerCase() ??
      record?.reviewStatus?.toLowerCase() ??
      null;

    let status = record?.status ?? "not_started";
    let approvedTier = record?.approvedTier ?? "NONE";

    if (reviewStatus === "completed") {
      if (record?.compressedAccountId) {
        const proofReady = await isValidityProofReady(record.compressedAccountId);
        if (proofReady) {
          status = "approved_ready";
          approvedTier = record.approvedTier;
          await setComplianceRecord(wallet, {
            status,
            approvedTier,
            proofReadyAt: Math.floor(Date.now() / 1000),
          });
        } else {
          status = "approved_indexing";
        }
      } else {
        status = "approved_indexing";
      }
    } else if (reviewStatus === "pending" || reviewStatus === "queued" || reviewStatus === "init") {
      status = "pending_review";
    } else if (reviewStatus === "rejected") {
      status = "rejected";
    }

    const meetsRequirement =
      requiredTier === "NONE" ? true : tierSatisfiesRequirement(approvedTier, requiredTier) && status === "approved_ready";

    const body: KycStatusResponse = {
      walletAddress: wallet,
      requiredTier,
      approvedTier,
      status,
      meetsRequirement,
      outOfPolicy: false,
      compressedAccountId: record?.compressedAccountId ?? null,
      leafIndex: record?.leafIndex ?? null,
      expiresAt: record?.expiresAt ?? null,
      message:
        status === "approved_indexing"
          ? "Minting on-chain compliance proof..."
          : status === "approved_ready"
            ? "Compliance proof is ready."
            : status === "pending_review"
              ? "KYC is under review."
              : status === "rejected"
                ? "KYC was rejected."
                : "KYC has not started.",
    };

    const response = NextResponse.json(body, { status: 200 });
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    if (isSumsubUpstreamError(error)) {
      const upstreamError = error;
      console.error("[KYC Status] Sumsub upstream failure.", {
        wallet: "session_scoped",
        message: upstreamError.message,
      });
      return NextResponse.json(
        { error: "Sumsub is temporarily unavailable." },
        { status: 502 },
      );
    }

    console.error("[KYC Status] Unexpected failure.", {
      wallet: "session_scoped",
      error,
    });
    return NextResponse.json({ error: "Failed to load KYC status." }, { status: 500 });
  }
}
