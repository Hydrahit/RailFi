export interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  decimals: number;
  mint: string;
  tokenStandard: string;
}

export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface HeliusAccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: Array<{
    userAccount: string;
    tokenAccount: string;
    mint: string;
    rawTokenAmount: { tokenAmount: string; decimals: number };
  }>;
}

export interface HeliusInstructionData {
  accounts: string[];
  data: string;
  programId: string;
  innerInstructions: HeliusInstructionData[];
}

export interface HeliusEnhancedTransaction {
  description: string;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  tokenTransfers: HeliusTokenTransfer[];
  nativeTransfers: HeliusNativeTransfer[];
  accountData: HeliusAccountData[];
  transactionError: string | null;
  instructions: HeliusInstructionData[];
  events: Record<string, unknown>;
}

export interface OfframpRecord {
  requestId: string;
  walletAddress: string;
  usdcAmount: number;
  upiId: string;
  lockedRate: number;
  estimatedInr: number;
  status: "PENDING" | "SETTLED" | "FAILED";
  compressionStatus: "PENDING" | "COMPRESSED" | "FAILED";
  compressionSignature: string | null;
  compressionError: string | null;
  receivedAt: number;
  signature: string;
}
