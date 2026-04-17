import "server-only";

import { createHash } from "crypto";
import { Redis } from "@upstash/redis";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeInstruction,
  getAssociatedTokenAddressSync,
  isTransferCheckedInstruction,
  isTransferInstruction,
} from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  BUBBLEGUM_PROGRAM_ID,
  PROGRAM_ID,
  SPL_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  USDC_USD_PYTH_ACCOUNT,
  deriveCircuitBreakerPda,
  deriveProtocolConfigPda,
  deriveProtocolTreasuryAta,
  deriveReferralConfigPda,
  deriveVaultPda,
  getTreeConfigPDA,
} from "@/lib/solana";
import { fetchProtocolConfigKeys, fetchReferralConfigByAddress } from "@/lib/relayer/builders";
import { loadRelayerKeypair } from "@/lib/relayer/keypair";
import { getComplianceRecord } from "@/lib/compliance/store";
import { FULL_TIER_LIMIT_PAISE, tierSatisfiesRequirement, type ComplianceTier } from "@/lib/compliance/types";

const MAX_RELAYS_PER_HOUR = 10;
const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId.toBase58();
const ALLOWED_AUXILIARY_PROGRAM_IDS = new Set([
  PROGRAM_ID.toBase58(),
  COMPUTE_BUDGET_PROGRAM_ID,
  TOKEN_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
]);

type RelayActionKind = "initialize_vault" | "deposit_usdc" | "trigger_offramp";

interface RelayInstructionContext {
  actionKind: RelayActionKind;
  userPubkey: string;
  amountMicroUsdc?: bigint;
  inrPaise?: bigint;
  expectedVaultAta?: PublicKey;
  expectedVaultOwner?: PublicKey;
  expectedMint?: PublicKey;
  expectedReferralConfig?: PublicKey;
  expectedReferrerAta?: PublicKey;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  userPubkey?: string;
  actionKind?: RelayActionKind;
}

let redisSingleton: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisSingleton !== undefined) {
    return redisSingleton;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!url || !token) {
    redisSingleton = null;
    return redisSingleton;
  }

  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}

function relayRateKey(userPubkey: string): string {
  return `railfi:relay:${userPubkey}:${Math.floor(Date.now() / 3_600_000)}`;
}

function instructionDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

const INITIALIZE_USER_DISCRIMINATOR = instructionDiscriminator("initialize_user");
const RECEIVE_USDC_DISCRIMINATOR = instructionDiscriminator("receive_usdc");
const TRIGGER_OFFRAMP_DISCRIMINATOR = instructionDiscriminator("trigger_offramp");

function equalDiscriminator(actual: Buffer, expected: Buffer): boolean {
  return actual.length >= expected.length && actual.subarray(0, expected.length).equals(expected);
}

function keyAt(ix: TransactionInstruction, index: number): PublicKey | null {
  return ix.keys[index]?.pubkey ?? null;
}

async function validateInitializeVaultInstruction(
  ix: TransactionInstruction,
): Promise<RelayInstructionContext | null> {
  const relayer = loadRelayerKeypair();
  const feePayer = keyAt(ix, 0);
  const user = keyAt(ix, 1);
  const userVault = keyAt(ix, 2);
  const systemProgram = keyAt(ix, 3);

  if (!feePayer?.equals(relayer.publicKey) || !user || !userVault || !systemProgram) {
    return null;
  }

  const [expectedVault] = deriveVaultPda(user);
  if (!userVault.equals(expectedVault) || !systemProgram.equals(SystemProgram.programId)) {
    return null;
  }

  return {
    actionKind: "initialize_vault",
    userPubkey: user.toBase58(),
  };
}

async function validateDepositInstruction(
  ix: TransactionInstruction,
): Promise<RelayInstructionContext | null> {
  const relayer = loadRelayerKeypair();
  const protocolConfig = await fetchProtocolConfigKeys();
  const [protocolConfigPda] = deriveProtocolConfigPda(PROGRAM_ID);
  const feePayer = keyAt(ix, 0);
  const user = keyAt(ix, 1);
  const protocolConfigKey = keyAt(ix, 2);
  const userVault = keyAt(ix, 3);
  const userUsdcAccount = keyAt(ix, 4);
  const vaultUsdcAccount = keyAt(ix, 5);
  const usdcMint = keyAt(ix, 6);
  const tokenProgram = keyAt(ix, 7);
  const associatedTokenProgram = keyAt(ix, 8);
  const systemProgram = keyAt(ix, 9);

  if (
    !feePayer?.equals(relayer.publicKey) ||
    !user ||
    !protocolConfigKey ||
    !userVault ||
    !userUsdcAccount ||
    !vaultUsdcAccount ||
    !usdcMint ||
    !tokenProgram ||
    !associatedTokenProgram ||
    !systemProgram
  ) {
    return null;
  }

  const [expectedVault] = deriveVaultPda(user);
  const expectedUserAta = getAssociatedTokenAddressSync(protocolConfig.usdcMint, user);
  const expectedVaultAta = getAssociatedTokenAddressSync(
    protocolConfig.usdcMint,
    expectedVault,
    true,
  );

  if (
    !protocolConfigKey.equals(protocolConfigPda) ||
    !userVault.equals(expectedVault) ||
    !userUsdcAccount.equals(expectedUserAta) ||
    !vaultUsdcAccount.equals(expectedVaultAta) ||
    !usdcMint.equals(protocolConfig.usdcMint) ||
    !tokenProgram.equals(TOKEN_PROGRAM_ID) ||
    !associatedTokenProgram.equals(ASSOCIATED_TOKEN_PROGRAM_ID) ||
    !systemProgram.equals(SystemProgram.programId)
  ) {
    return null;
  }

  return {
    actionKind: "deposit_usdc",
    userPubkey: user.toBase58(),
    expectedVaultAta,
    expectedVaultOwner: expectedVault,
    expectedMint: protocolConfig.usdcMint,
  };
}

async function validateTriggerOfframpInstruction(
  ix: TransactionInstruction,
): Promise<RelayInstructionContext | null> {
  const relayer = loadRelayerKeypair();
  const protocolConfig = await fetchProtocolConfigKeys();
  const [protocolConfigPda] = deriveProtocolConfigPda(PROGRAM_ID);
  const [circuitBreakerPda] = deriveCircuitBreakerPda(PROGRAM_ID);
  const feePayer = keyAt(ix, 0);
  const kycAuthority = keyAt(ix, 1);
  const user = keyAt(ix, 2);
  const protocolConfigKey = keyAt(ix, 3);
  const circuitBreaker = keyAt(ix, 4);
  const usdcUsdPriceUpdate = keyAt(ix, 5);
  const userVault = keyAt(ix, 6);
  const vaultUsdcAccount = keyAt(ix, 8);
  const protocolTreasuryAta = keyAt(ix, 9);
  const usdcMint = keyAt(ix, 10);
  const merkleTree = keyAt(ix, 11);
  const treeConfig = keyAt(ix, 12);
  const bubblegumProgram = keyAt(ix, 13);
  const logWrapper = keyAt(ix, 14);
  const compressionProgram = keyAt(ix, 15);
  const tokenProgram = keyAt(ix, 16);
  const systemProgram = keyAt(ix, 17);

  if (
    !feePayer?.equals(relayer.publicKey) ||
    !kycAuthority?.equals(relayer.publicKey) ||
    !user ||
    !protocolConfigKey ||
    !circuitBreaker ||
    !usdcUsdPriceUpdate ||
    !userVault ||
    !vaultUsdcAccount ||
    !protocolTreasuryAta ||
    !usdcMint ||
    !merkleTree ||
    !treeConfig ||
    !bubblegumProgram ||
    !logWrapper ||
    !compressionProgram ||
    !tokenProgram ||
    !systemProgram
  ) {
    return null;
  }

  const [expectedVault] = deriveVaultPda(user);
  const expectedVaultAta = getAssociatedTokenAddressSync(
    protocolConfig.usdcMint,
    expectedVault,
    true,
  );
  const expectedProtocolTreasuryAta = deriveProtocolTreasuryAta(
    protocolConfig.usdcMint,
    protocolConfigPda,
  );

  if (
    !protocolConfigKey.equals(protocolConfigPda) ||
    !protocolConfig.kycAuthority.equals(relayer.publicKey) ||
    !circuitBreaker.equals(circuitBreakerPda) ||
    !usdcUsdPriceUpdate.equals(USDC_USD_PYTH_ACCOUNT) ||
    !userVault.equals(expectedVault) ||
    !vaultUsdcAccount.equals(expectedVaultAta) ||
    !protocolTreasuryAta.equals(expectedProtocolTreasuryAta) ||
    !usdcMint.equals(protocolConfig.usdcMint) ||
    !merkleTree.equals(protocolConfig.merkleTree) ||
    !treeConfig.equals(getTreeConfigPDA(protocolConfig.merkleTree)) ||
    !bubblegumProgram.equals(BUBBLEGUM_PROGRAM_ID) ||
    !logWrapper.equals(SPL_NOOP_PROGRAM_ID) ||
    !compressionProgram.equals(SPL_COMPRESSION_PROGRAM_ID) ||
    !tokenProgram.equals(TOKEN_PROGRAM_ID) ||
    !systemProgram.equals(SystemProgram.programId)
  ) {
    return null;
  }

  let expectedReferralConfig: PublicKey | undefined;
  let expectedReferrerAta: PublicKey | undefined;

  if (ix.keys.length > 18) {
    const referralConfigKey = keyAt(ix, 18);
    const referrerAta = keyAt(ix, 19);
    if (!referralConfigKey || !referrerAta || ix.keys.length !== 20) {
      return null;
    }

    try {
      const referralConfig = await fetchReferralConfigByAddress(referralConfigKey);
      expectedReferralConfig = deriveReferralConfigPda(referralConfig.referrer, PROGRAM_ID)[0];
      expectedReferrerAta = getAssociatedTokenAddressSync(
        protocolConfig.usdcMint,
        referralConfig.referrer,
      );
      if (
        !referralConfig.isActive ||
        !referralConfigKey.equals(expectedReferralConfig) ||
        !referrerAta.equals(expectedReferrerAta)
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return {
    actionKind: "trigger_offramp",
    userPubkey: user.toBase58(),
    amountMicroUsdc: BigInt(ix.data.subarray(8, 16).reduceRight((acc, byte) => (acc << BigInt(8)) + BigInt(byte), BigInt(0))),
    inrPaise: BigInt(ix.data.subarray(ix.data.length - 8).reduceRight((acc, byte) => (acc << BigInt(8)) + BigInt(byte), BigInt(0))),
    expectedVaultAta,
    expectedVaultOwner: expectedVault,
    expectedMint: protocolConfig.usdcMint,
    expectedReferralConfig,
    expectedReferrerAta,
  };
}

function requiredTierForInrPaise(inrPaise: bigint): ComplianceTier {
  if (inrPaise <= BigInt(0)) {
    return "NONE";
  }
  if (inrPaise <= BigInt(50_000 * 100)) {
    return "LITE";
  }
  if (inrPaise <= BigInt(FULL_TIER_LIMIT_PAISE)) {
    return "FULL";
  }
  return "NONE";
}

async function validateKycEligibility(context: RelayInstructionContext): Promise<PolicyResult> {
  if (context.actionKind !== "trigger_offramp" || !context.userPubkey || !context.inrPaise) {
    return { allowed: true };
  }

  const requiredTier = requiredTierForInrPaise(context.inrPaise);
  if (requiredTier === "NONE") {
    return { allowed: false, reason: "Requested INR amount exceeds the MVP KYC policy limit." };
  }

  const record = await getComplianceRecord(context.userPubkey);
  if (!record) {
    return { allowed: false, reason: "KYC is required before triggering an offramp." };
  }

  if (record.status !== "approved_ready") {
    return { allowed: false, reason: "Compliance proof is still indexing or pending approval." };
  }

  if (!record.compressedAccountId || !record.expiresAt || record.expiresAt <= Math.floor(Date.now() / 1000)) {
    return { allowed: false, reason: "Compliance attestation is missing or expired." };
  }

  if (!tierSatisfiesRequirement(record.approvedTier, requiredTier)) {
    return { allowed: false, reason: "KYC tier is insufficient for this offramp amount." };
  }

  return { allowed: true };
}

async function validateRailpayInstruction(
  ix: TransactionInstruction,
): Promise<RelayInstructionContext | null> {
  const discriminator = Buffer.from(ix.data);

  if (equalDiscriminator(discriminator, INITIALIZE_USER_DISCRIMINATOR)) {
    return validateInitializeVaultInstruction(ix);
  }

  if (equalDiscriminator(discriminator, RECEIVE_USDC_DISCRIMINATOR)) {
    return validateDepositInstruction(ix);
  }

  if (equalDiscriminator(discriminator, TRIGGER_OFFRAMP_DISCRIMINATOR)) {
    return validateTriggerOfframpInstruction(ix);
  }

  return null;
}

function validateAssociatedTokenInstruction(
  ix: TransactionInstruction,
  expectedVaultAta: PublicKey,
  expectedVaultOwner: PublicKey,
  expectedMint: PublicKey,
): boolean {
  const relayer = loadRelayerKeypair();
  return (
    ix.keys.length >= 6 &&
    ix.keys[0]?.pubkey.equals(relayer.publicKey) &&
    ix.keys[1]?.pubkey.equals(expectedVaultAta) &&
    ix.keys[2]?.pubkey.equals(expectedVaultOwner) &&
    ix.keys[3]?.pubkey.equals(expectedMint) &&
    ix.keys[4]?.pubkey.equals(SystemProgram.programId) &&
    ix.keys[5]?.pubkey.equals(TOKEN_PROGRAM_ID)
  );
}

function validateTokenInstruction(
  ix: TransactionInstruction,
  expectedVaultAta: PublicKey,
): boolean {
  try {
    const decoded = decodeInstruction(ix, TOKEN_PROGRAM_ID);

    if (isTransferInstruction(decoded)) {
      return decoded.keys.destination.pubkey.equals(expectedVaultAta);
    }

    if (isTransferCheckedInstruction(decoded)) {
      return decoded.keys.destination.pubkey.equals(expectedVaultAta);
    }

    return false;
  } catch {
    return false;
  }
}

export async function enforceRelayRateLimit(userPubkey: string): Promise<PolicyResult> {
  const redis = getRedis();
  if (!redis) {
    return { allowed: true, userPubkey };
  }

  const key = relayRateKey(userPubkey);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 3600);
  }

  if (count > MAX_RELAYS_PER_HOUR) {
    return {
      allowed: false,
      reason: "Rate limit exceeded — 10 relays per hour",
      userPubkey,
    };
  }

  return { allowed: true, userPubkey };
}

export async function validateRelayRequest(
  tx: Transaction,
  requireAllSignatures: boolean,
): Promise<PolicyResult> {
  const relayer = loadRelayerKeypair();

  if (!tx.feePayer?.equals(relayer.publicKey)) {
    return { allowed: false, reason: "Unauthorized fee payer" };
  }

  if (!tx.recentBlockhash) {
    return { allowed: false, reason: "Missing recent blockhash" };
  }

  if (!tx.verifySignatures(!requireAllSignatures ? false : undefined)) {
    return { allowed: false, reason: "Invalid transaction signatures" };
  }

  const primaryInstruction = tx.instructions.find((ix) => ix.programId.equals(PROGRAM_ID));
  if (!primaryInstruction) {
    return { allowed: false, reason: "Missing RailFi instruction" };
  }

  const primaryContext = await validateRailpayInstruction(primaryInstruction);
  if (!primaryContext) {
    return { allowed: false, reason: "Instruction targets unauthorized RailFi action" };
  }

  const kycPolicy = await validateKycEligibility(primaryContext);
  if (!kycPolicy.allowed) {
    return kycPolicy;
  }

  const userSignature = tx.signatures.find((signature) =>
    signature.publicKey.toBase58() === primaryContext.userPubkey,
  );
  if (requireAllSignatures && !userSignature?.signature) {
    return { allowed: false, reason: "Missing user signature" };
  }

  for (const ix of tx.instructions) {
    const programId = ix.programId.toBase58();

    if (programId === PROGRAM_ID.toBase58()) {
      continue;
    }

    if (programId === TOKEN_PROGRAM_ID.toBase58()) {
      if (!primaryContext.expectedVaultAta || !validateTokenInstruction(ix, primaryContext.expectedVaultAta)) {
        return { allowed: false, reason: "Token transfer targets unauthorized destination" };
      }
      continue;
    }

    if (programId === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
      if (
        !primaryContext.expectedVaultAta ||
        !primaryContext.expectedVaultOwner ||
        !primaryContext.expectedMint ||
        !validateAssociatedTokenInstruction(
          ix,
          primaryContext.expectedVaultAta,
          primaryContext.expectedVaultOwner,
          primaryContext.expectedMint,
        )
      ) {
        return { allowed: false, reason: "ATA creation targets unauthorized destination" };
      }
      continue;
    }

    if (programId === SystemProgram.programId.toBase58()) {
      return { allowed: false, reason: "Native SOL transfers are not relayable" };
    }

    if (ALLOWED_AUXILIARY_PROGRAM_IDS.has(programId)) {
      continue;
    }

    console.error("[FIREWALL BLOCKED] Unauthorized Program ID:", programId);
    return { allowed: false, reason: "Instruction targets unauthorized program" };
  }

  return {
    allowed: true,
    actionKind: primaryContext.actionKind,
    userPubkey: primaryContext.userPubkey,
  };
}
