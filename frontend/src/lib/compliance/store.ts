import "server-only";

import type { ComplianceRecord, ComplianceTier, KycLifecycleStatus } from "@/lib/compliance/types";
import { getServerRedis } from "@/lib/upstash";

function recordKey(walletAddress: string): string {
  return `railfi:kyc:${walletAddress}`;
}

export function getKycTtlSeconds(): number {
  const raw = Number(process.env.KYC_ATTESTATION_TTL_SECONDS ?? "31536000");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 31_536_000;
}

export async function getComplianceRecord(walletAddress: string): Promise<ComplianceRecord | null> {
  const redis = getServerRedis("KYC storage");
  const record = await redis.get<ComplianceRecord>(recordKey(walletAddress));
  return record ?? null;
}

export async function setComplianceRecord(
  walletAddress: string,
  partial: Partial<ComplianceRecord>,
): Promise<ComplianceRecord> {
  const redis = getServerRedis("KYC storage");
  const current = (await getComplianceRecord(walletAddress)) ?? {
    walletAddress,
    requestedTier: "NONE" as ComplianceTier,
    approvedTier: "NONE" as ComplianceTier,
    sumsubApplicantId: null,
    reviewStatus: null,
    status: "not_started" as KycLifecycleStatus,
    compressedAccountId: null,
    leafIndex: null,
    issuedAt: null,
    expiresAt: null,
    proofReadyAt: null,
    version: 1,
  };

  const next = {
    ...current,
    ...partial,
    walletAddress,
    version: current.version ?? 1,
  };

  await redis.set(recordKey(walletAddress), next);
  return next;
}
