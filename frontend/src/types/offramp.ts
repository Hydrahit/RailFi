export type OfframpStatus =
  | "STAGED"
  | "ON_CHAIN_CONFIRMED"
  | "PAYOUT_PENDING"
  | "SUCCESS"
  | "FAILED"
  | "REVERSED"
  | "REQUIRES_REVIEW";

export interface OfframpRecord {
  transferId: string;
  solanaTx: string;
  cashfreeId: string;
  walletAddress: string;
  amountUsdc: number;
  amountMicroUsdc: string;
  amountInr: number;
  amountInrPaise: number;
  upiMasked: string;
  upiHash?: string | null;
  status: OfframpStatus;
  utr: string | null;
  createdAt: string;
  completedAt: string | null;
  requiresReview: boolean;
  failureReason?: string | null;
  retryCount?: number;
  lastRetryAt?: string | null;
  referralPubkey: string | null;
}

export interface OfframpDeadLetterRecord {
  transferId: string;
  receivedAt: string;
  payload: string;
  provider?: string;
  reason?: string | null;
}

export interface StoredUpiHandle {
  id: string;
  upiHash: string;
  upiMasked: string;
  bankName: string;
  isDefault: boolean;
  addedAt: string;
}

export interface ProfileSummary {
  walletAddress: string;
  shortAddress: string;
  avatarSeed: string;
  memberSince: string | null;
  totalOfframpedInr: number;
  totalOfframpedCount: number;
  kycTier: 0 | 1 | 2 | 3;
  kycTierLabel: "Unverified" | "Basic" | "Standard" | "Premium";
  dailyLimitInr: number;
  monthlyLimitInr: number;
  usedTodayInr: number;
  usedMonthInr: number;
  kycVerifiedAt: string | null;
  handles: StoredUpiHandle[];
  googleLinked: boolean;
  walletLinked: boolean;
}
