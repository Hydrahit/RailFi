import { Buffer } from "buffer";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/solana";

const REFERRAL_CONFIG_SEED = Buffer.from("referral_config");

const PROTOCOL_FEE_BPS = BigInt(100);

export interface ReferralConfigAccount {
  pda: string;
  referrer: string;
  feeBps: number;
  totalEarnedUsdc: number;
  totalReferred: number;
  isActive: boolean;
  bump: number;
}

export interface OfframpChargeBreakdown {
  amountUsdc: number;
  protocolFeeUsdc: number;
  referralFeeUsdc: number;
  totalDeductedUsdc: number;
}

function readU64(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true);
}

function readU16(data: Uint8Array, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint16(offset, true);
}

function toUsdcNumber(microUsdc: bigint): number {
  return Number(microUsdc) / 1_000_000;
}

function toMicroUsdc(amountUsdc: number): bigint {
  return BigInt(Math.round(amountUsdc * 1_000_000));
}

export function deriveReferralConfigPda(referrer: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [REFERRAL_CONFIG_SEED, referrer.toBuffer()],
    PROGRAM_ID,
  );
}

export function calculateOfframpChargeBreakdown(
  amountUsdc: number,
  referralFeeBps?: number | null,
): OfframpChargeBreakdown {
  const amountMicroUsdc = toMicroUsdc(Math.max(amountUsdc, 0));
  const protocolFeeMicroUsdc = (amountMicroUsdc * PROTOCOL_FEE_BPS) / BigInt(10_000);
  const normalizedReferralFeeBps = BigInt(Math.max(referralFeeBps ?? 0, 0));
  const referralFeeMicroUsdc =
    normalizedReferralFeeBps > 0
      ? (protocolFeeMicroUsdc * normalizedReferralFeeBps) / BigInt(10_000)
      : BigInt(0);
  const totalDeductedMicroUsdc =
    amountMicroUsdc + protocolFeeMicroUsdc + referralFeeMicroUsdc;

  return {
    amountUsdc: toUsdcNumber(amountMicroUsdc),
    protocolFeeUsdc: toUsdcNumber(protocolFeeMicroUsdc),
    referralFeeUsdc: toUsdcNumber(referralFeeMicroUsdc),
    totalDeductedUsdc: toUsdcNumber(totalDeductedMicroUsdc),
  };
}

export function maxPrincipalFromAvailableUsdc(
  availableUsdc: number,
  referralFeeBps?: number | null,
): number {
  const multiplier =
    1 +
    Number(PROTOCOL_FEE_BPS) / 10_000 +
    (Number(PROTOCOL_FEE_BPS) / 10_000) * ((referralFeeBps ?? 0) / 10_000);

  if (availableUsdc <= 0 || multiplier <= 0) {
    return 0;
  }

  return Math.max(availableUsdc / multiplier, 0);
}

export async function fetchReferralConfig(
  connection: Connection,
  referrer: PublicKey,
): Promise<ReferralConfigAccount | null> {
  const [pda] = deriveReferralConfigPda(referrer);
  const accountInfo = await connection.getAccountInfo(pda, "confirmed");
  if (!accountInfo || !accountInfo.owner.equals(PROGRAM_ID) || accountInfo.data.length < 60) {
    return null;
  }

  const data = accountInfo.data;
  const offset = 8;
  const referrerKey = new PublicKey(data.subarray(offset, offset + 32));
  const feeBps = readU16(data, offset + 32);
  const totalEarnedUsdc = readU64(data, offset + 34);
  const totalReferred = readU64(data, offset + 42);
  const isActive = data[offset + 50] === 1;
  const bump = data[offset + 51] ?? 0;

  return {
    pda: pda.toBase58(),
    referrer: referrerKey.toBase58(),
    feeBps,
    totalEarnedUsdc: toUsdcNumber(totalEarnedUsdc),
    totalReferred: Number(totalReferred),
    isActive,
    bump,
  };
}



