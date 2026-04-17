export type ComplianceTier = "NONE" | "LITE" | "FULL";

export type KycLifecycleStatus =
  | "not_started"
  | "pending_review"
  | "approved_indexing"
  | "approved_ready"
  | "rejected";

export interface ComplianceRecord {
  walletAddress: string;
  requestedTier: ComplianceTier;
  approvedTier: ComplianceTier;
  sumsubApplicantId: string | null;
  reviewStatus: string | null;
  status: KycLifecycleStatus;
  compressedAccountId: string | null;
  leafIndex: number | null;
  issuedAt: number | null;
  expiresAt: number | null;
  proofReadyAt: number | null;
  version: number;
}

export interface KycStatusResponse {
  walletAddress: string;
  requiredTier: ComplianceTier;
  approvedTier: ComplianceTier;
  status: KycLifecycleStatus;
  meetsRequirement: boolean;
  outOfPolicy: boolean;
  compressedAccountId: string | null;
  leafIndex: number | null;
  expiresAt: number | null;
  message: string;
}

export const LITE_TIER_LIMIT_PAISE = 50_000 * 100;
export const FULL_TIER_LIMIT_PAISE = 500_000 * 100;

export function normalizeTier(value: string | null | undefined): ComplianceTier {
  if (value === "FULL") {
    return "FULL";
  }
  if (value === "LITE") {
    return "LITE";
  }
  return "NONE";
}

export function tierForEstimatedInr(estimatedInr: number | null): ComplianceTier {
  if (!estimatedInr || estimatedInr <= 0) {
    return "NONE";
  }
  if (estimatedInr <= 50_000) {
    return "LITE";
  }
  if (estimatedInr <= 500_000) {
    return "FULL";
  }
  return "NONE";
}

export function tierForInrPaise(inrPaise: number): ComplianceTier {
  if (!Number.isFinite(inrPaise) || inrPaise <= 0) {
    return "NONE";
  }
  if (inrPaise <= LITE_TIER_LIMIT_PAISE) {
    return "LITE";
  }
  if (inrPaise <= FULL_TIER_LIMIT_PAISE) {
    return "FULL";
  }
  return "NONE";
}

export function tierSatisfiesRequirement(
  approvedTier: ComplianceTier,
  requiredTier: ComplianceTier,
): boolean {
  const order: Record<ComplianceTier, number> = {
    NONE: 0,
    LITE: 1,
    FULL: 2,
  };
  return order[approvedTier] >= order[requiredTier];
}

