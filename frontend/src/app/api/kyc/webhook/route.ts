import { NextRequest, NextResponse } from "next/server";
import { issueComplianceAttestation } from "@/lib/compliance/attester";
import { getComplianceRecord, setComplianceRecord } from "@/lib/compliance/store";
import { normalizeTier } from "@/lib/compliance/types";
import { verifyWebhookSignature } from "@/lib/sumsub";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractWallet(payload: Record<string, unknown>): string | null {
  const direct = typeof payload.externalUserId === "string" ? payload.externalUserId : null;
  if (direct) {
    return direct;
  }
  const applicant = payload.applicant as Record<string, unknown> | undefined;
  return typeof applicant?.externalUserId === "string" ? applicant.externalUserId : null;
}

function extractApplicantId(payload: Record<string, unknown>): string | null {
  if (typeof payload.applicantId === "string") {
    return payload.applicantId;
  }
  const applicant = payload.applicant as Record<string, unknown> | undefined;
  return typeof applicant?.id === "string" ? applicant.id : null;
}

function extractReviewStatus(payload: Record<string, unknown>): string | null {
  if (typeof payload.reviewStatus === "string") {
    return payload.reviewStatus;
  }
  const reviewResult = payload.reviewResult as Record<string, unknown> | undefined;
  if (typeof reviewResult?.reviewAnswer === "string") {
    return reviewResult.reviewAnswer;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "kycWebhookIp",
    "KYC webhook rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  const rawBody = await request.text();
  const digest = request.headers.get("x-payload-digest");
  const digestAlg = request.headers.get("x-payload-digest-alg");
  if (!verifyWebhookSignature(rawBody, digest, digestAlg)) {
    return NextResponse.json({ error: "Invalid Sumsub webhook signature." }, { status: 403 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid Sumsub webhook payload." }, { status: 400 });
  }
  const walletAddress = extractWallet(payload);
  const applicantId = extractApplicantId(payload);
  const reviewStatus = extractReviewStatus(payload)?.toUpperCase() ?? "PENDING";

  if (!walletAddress) {
    return NextResponse.json({ error: "Missing externalUserId on webhook payload." }, { status: 400 });
  }

  const existingRecord = await getComplianceRecord(walletAddress);
  const requestedTier = normalizeTier(
    typeof payload["requiredTier"] === "string"
      ? (payload["requiredTier"] as string)
      : existingRecord?.requestedTier ?? null,
  );
  const approvedTier = requestedTier === "NONE" ? existingRecord?.requestedTier ?? "LITE" : requestedTier;

  if (reviewStatus === "GREEN") {
    const attestation = await issueComplianceAttestation({
      walletAddress,
      approvedTier,
      applicantId: applicantId ?? walletAddress,
    });

    await setComplianceRecord(walletAddress, {
      approvedTier,
      requestedTier,
      sumsubApplicantId: applicantId,
      reviewStatus: reviewStatus.toLowerCase(),
      status: "approved_indexing",
      compressedAccountId: attestation.compressedAccountId,
      leafIndex: attestation.leafIndex,
      issuedAt: attestation.issuedAt,
      expiresAt: attestation.expiresAt,
    });

    return NextResponse.json({ success: true });
  }

  await setComplianceRecord(walletAddress, {
    requestedTier,
    sumsubApplicantId: applicantId,
    reviewStatus: reviewStatus.toLowerCase(),
    status: reviewStatus === "RED" ? "rejected" : "pending_review",
  });

  return NextResponse.json({ success: true });
}
