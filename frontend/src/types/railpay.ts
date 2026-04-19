// ─── types/railpay.ts ─────────────────────────────────────────────────────────
// Shared TypeScript types for RailFi frontend
// Mirrors the on-chain UserVault account layout and app-level state

import type { PublicKey } from "@solana/web3.js";

export interface ProtocolConfigAccount {
  admin: PublicKey;
  relayerAuthority: PublicKey;
  usdcMint: PublicKey;
  merkleTree: PublicKey;
  kycAuthority: PublicKey;
  oracleMaxAge: bigint;
  kaminoEnabled: boolean;
  bump: number;
}

export interface ProtocolConfigDisplay {
  admin: string;
  relayerAuthority: string;
  usdcMint: string;
  merkleTree: string;
  kycAuthority: string;
  oracleMaxAge: number;
  kaminoEnabled: boolean;
  bump: number;
}

// ── On-chain account type ──────────────────────────────────────────────────
export interface VaultAccount {
  owner:          PublicKey;
  upiHandleHash:  number[];    // [u8; 32] — SHA-256 hash of normalized UPI ID
  totalReceived:  bigint;      // micro-USDC
  totalOfframped: bigint;      // micro-USDC
  receiptCount:   number;
  bump:           number;
  isActive:       boolean;
}

// ── Derived display type (UI-ready) ───────────────────────────────────────
export interface VaultDisplay {
  isInitialized:  boolean;
  isActive:       boolean;
  upiHandle:      string;      // privacy-safe vault routing status label
  totalReceived:  number;      // in USDC (divided by 1_000_000)
  totalOfframped: number;
  availableUsdc:  number;      // logical amount still available to offramp
  escrowUsdc:     number;      // actual ATA balance held by the vault PDA
  receiptCount:   number;
  bump:           number;
}

// ── Wallet balances ────────────────────────────────────────────────────────
export interface WalletBalances {
  sol:       number;
  usdc:      number;
  isLoading: boolean;
}

// ── Transaction record (from on-chain events / indexer) ───────────────────
export interface Transaction {
  id:          string;         // signature
  type:        "receive" | "offramp";
  amount:      number;         // USDC
  inrAmount?:  number;         // paise (for offramp)
  upiId?:      string;
  timestamp:   number;         // unix ms
  status:      "confirmed" | "pending" | "failed";
  explorerUrl: string;
  receiptId?:  number;         // cNFT receipt ID for offramp
}

// ── UPI validation ────────────────────────────────────────────────────────
export interface UpiValidationResponse {
  isValid:    boolean;
  vpa:        string;
  name?:      string;          // beneficiary name if resolved
  bank?:      string;
  error?:     string;
}

// ── Offramp form state machine ────────────────────────────────────────────
export type OfframpPhase =
  | "idle"
  | "validating"
  | "awaiting_signature"
  | "confirming"
  | "settling"
  | "done"
  | "error";

export type FundingPhase =
  | "idle"
  | "awaiting_signature"
  | "confirming"
  | "done"
  | "error";

export interface OfframpState {
  phase:   OfframpPhase;
  txSig?:  string;
  error?:  string;
  result?: {
    signature:   string;
    receiptId:   number;
    explorerUrl: string;
    inrAmount:   number;
  };
}

// ── Rate tiers ────────────────────────────────────────────────────────────
export interface RateTier {
  label:       string;
  minUsdc:     number;
  maxUsdc:     number | null;  // null = unlimited
  feePercent:  number;
  badge?:      string;
}

// ── Quick action ──────────────────────────────────────────────────────────
export interface QuickAction {
  label:   string;
  href:    string;
  icon:    string;
  accent?: boolean;
}
