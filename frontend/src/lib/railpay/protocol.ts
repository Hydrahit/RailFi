"use client";

import { Buffer } from "buffer";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { ProtocolConfigDisplay } from "@/types/railpay";

const PROTOCOL_CONFIG_DISCRIMINATOR = Buffer.from([207, 91, 250, 28, 152, 179, 215, 209]);
const LEGACY_PROTOCOL_CONFIG_DATA_LENGTH = 138;
const ORACLE_AWARE_PROTOCOL_CONFIG_DATA_LENGTH = 146;
const CURRENT_PROTOCOL_CONFIG_DATA_LENGTH = 178;

export interface ProtocolConfigAccountData {
  admin: PublicKey;
  relayerAuthority: PublicKey | null;
  usdcMint: PublicKey;
  merkleTree: PublicKey;
  kycAuthority: PublicKey;
  oracleMaxAge: BN;
  kaminoEnabled: boolean;
  bump: number;
}

export interface ProtocolConfigKeys {
  admin: PublicKey;
  relayerAuthority: PublicKey | null;
  usdcMint: PublicKey;
  merkleTree: PublicKey;
  kycAuthority: PublicKey;
  oracleMaxAge: BN;
  kaminoEnabled: boolean;
  bump: number;
}

export function formatProtocolConfigError(error: unknown): string {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    message.includes("account discriminator") ||
    message.includes("failed to deserialize") ||
    message.includes("invalid account data") ||
    message.includes("unexpected end of buffer") ||
    message.includes("buffer") ||
    message.includes("decode")
  ) {
    return "Protocol config uses a stale pre-oracle layout. Re-run protocol initialization or migration with the latest protocol configuration before testing.";
  }

  return "Protocol config is missing or still on a pre-oracle / pre-referral layout. Re-run protocol initialization with the latest protocol settings before testing.";
}

export function decodeProtocolConfigAccount(data: Buffer): ProtocolConfigAccountData {
  if (
    data.length < LEGACY_PROTOCOL_CONFIG_DATA_LENGTH ||
    !data.subarray(0, 8).equals(PROTOCOL_CONFIG_DISCRIMINATOR)
  ) {
    throw new Error("Invalid protocol config account discriminator or size.");
  }

  const isCurrentLayout = data.length >= CURRENT_PROTOCOL_CONFIG_DATA_LENGTH;
  const isOracleAwareLayout = data.length >= ORACLE_AWARE_PROTOCOL_CONFIG_DATA_LENGTH;

  let offset = 8;
  const admin = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  let relayerAuthority: PublicKey | null = null;
  if (isCurrentLayout) {
    relayerAuthority = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
  }

  const usdcMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const merkleTree = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const kycAuthority = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  let oracleMaxAge = new BN(0);
  if (isOracleAwareLayout) {
    oracleMaxAge = new BN(data.readBigUInt64LE(offset).toString());
    offset += 8;
  }

  const kaminoEnabled = data.readUInt8(offset) === 1;
  offset += 1;
  const bump = data.readUInt8(offset);

  return {
    admin,
    relayerAuthority,
    usdcMint,
    merkleTree,
    kycAuthority,
    oracleMaxAge,
    kaminoEnabled,
    bump,
  };
}

export function toSafeOracleMaxAge(value: BN): number {
  try {
    return value.toNumber();
  } catch {
    return 0;
  }
}

export function toProtocolConfigDisplay(
  config: ProtocolConfigAccountData,
): ProtocolConfigDisplay {
  return {
    admin: config.admin.toBase58(),
    relayerAuthority:
      config.relayerAuthority?.toBase58() ?? config.kycAuthority.toBase58(),
    usdcMint: config.usdcMint.toBase58(),
    merkleTree: config.merkleTree.toBase58(),
    kycAuthority: config.kycAuthority.toBase58(),
    oracleMaxAge: toSafeOracleMaxAge(config.oracleMaxAge),
    kaminoEnabled: config.kaminoEnabled,
    bump: config.bump,
  };
}
