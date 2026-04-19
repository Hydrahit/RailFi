import { Buffer } from "buffer";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { resolvePublicKeyEnv } from "@/lib/public-env";

const DEFAULT_PROGRAM_ID = "EfjBUSFyCMEVkcbc66Dzj94qRrYcC9ojKrmdWqk4Thin";
const DEFAULT_USDC_MINT = "UmuRwgXdbLqNUfu8rTFyuFuyPBBV1pPiL5FaR145U5F";
const DEFAULT_MERKLE_TREE = "EzgywgnDidZX55z2U3UESgbVaGJiSSCWprHGKURht3xw";
const DEFAULT_BUBBLEGUM_PROGRAM_ID = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
const DEFAULT_SPL_NOOP_PROGRAM_ID = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";
const DEFAULT_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK";
const CANONICAL_USDC_USD_PYTH_ACCOUNT = "5SSkXsEKQepjZLouepNSkHLuWcjFmdCPmZKK9T1AxgGA";

function resolveCanonicalUsdcUsdPythAccount(): PublicKey {
  const configured = process.env.NEXT_PUBLIC_USDC_USD_PYTH_ACCOUNT?.trim();
  if (!configured) {
    return new PublicKey(CANONICAL_USDC_USD_PYTH_ACCOUNT);
  }

  let parsed: PublicKey;
  try {
    parsed = new PublicKey(configured);
  } catch {
    throw new Error(
      `[solana] NEXT_PUBLIC_USDC_USD_PYTH_ACCOUNT="${configured}" is not a valid base58 public key.`,
    );
  }

  if (parsed.toBase58() !== CANONICAL_USDC_USD_PYTH_ACCOUNT) {
    throw new Error(
      `[solana] NEXT_PUBLIC_USDC_USD_PYTH_ACCOUNT must equal the canonical USDC/USD Pyth push-feed account ${CANONICAL_USDC_USD_PYTH_ACCOUNT}.`,
    );
  }

  return parsed;
}

export const PROGRAM_ID = resolvePublicKeyEnv(
  process.env.NEXT_PUBLIC_PROGRAM_ID,
  DEFAULT_PROGRAM_ID,
  "NEXT_PUBLIC_PROGRAM_ID",
);

export const CONFIGURED_USDC_MINT = resolvePublicKeyEnv(
  process.env.NEXT_PUBLIC_USDC_MINT,
  DEFAULT_USDC_MINT,
  "NEXT_PUBLIC_USDC_MINT",
);

export const CONFIGURED_MERKLE_TREE = resolvePublicKeyEnv(
  process.env.NEXT_PUBLIC_MERKLE_TREE,
  DEFAULT_MERKLE_TREE,
  "NEXT_PUBLIC_MERKLE_TREE",
);

export const MERKLE_TREE = CONFIGURED_MERKLE_TREE;

export const BUBBLEGUM_PROGRAM_ID = resolvePublicKeyEnv(
  process.env.NEXT_PUBLIC_BUBBLEGUM_PROGRAM_ID,
  DEFAULT_BUBBLEGUM_PROGRAM_ID,
  "NEXT_PUBLIC_BUBBLEGUM_PROGRAM_ID",
  false,
);

export const SPL_NOOP_PROGRAM_ID = resolvePublicKeyEnv(
  process.env.NEXT_PUBLIC_SPL_NOOP_PROGRAM_ID,
  DEFAULT_SPL_NOOP_PROGRAM_ID,
  "NEXT_PUBLIC_SPL_NOOP_PROGRAM_ID",
  false,
);

export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = resolvePublicKeyEnv(
  process.env.NEXT_PUBLIC_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  DEFAULT_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  "NEXT_PUBLIC_SPL_ACCOUNT_COMPRESSION_PROGRAM_ID",
  false,
);

export const SPL_COMPRESSION_PROGRAM_ID = SPL_ACCOUNT_COMPRESSION_PROGRAM_ID;

export const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config_v2");
export const CIRCUIT_BREAKER_SEED = Buffer.from("circuit_breaker");
export const USER_VAULT_SEED = Buffer.from("user_vault");
export const OFFRAMP_REQUEST_SEED = Buffer.from("offramp_request");
export const REFERRAL_CONFIG_SEED = Buffer.from("referral_config");
export const VAULT_SEED = USER_VAULT_SEED;
export const USDC_DECIMALS = 6;
export const USDC_USD_PYTH_ACCOUNT = resolveCanonicalUsdcUsdPythAccount();

let connectionSingleton: Connection | null = null;

export function getConnection(): Connection {
  if (!connectionSingleton) {
    connectionSingleton = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet"),
      { commitment: "confirmed" },
    );
  }
  return connectionSingleton;
}

export function deriveVaultPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_VAULT_SEED, owner.toBuffer()],
    PROGRAM_ID,
  );
}

export function deriveProtocolConfigPda(
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], programId);
}

export function deriveProtocolTreasuryAta(
  usdcMint: PublicKey,
  protocolConfigPda: PublicKey = deriveProtocolConfigPda(PROGRAM_ID)[0],
): PublicKey {
  return getAssociatedTokenAddressSync(usdcMint, protocolConfigPda, true);
}

export function deriveCircuitBreakerPda(
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CIRCUIT_BREAKER_SEED], programId);
}

export function deriveOfframpRequestPda(
  vault: PublicKey,
  currentReceiptCount: number,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  const receiptSeed = Buffer.alloc(4);
  receiptSeed.writeUInt32LE(currentReceiptCount, 0);
  return PublicKey.findProgramAddressSync(
    [OFFRAMP_REQUEST_SEED, vault.toBuffer(), receiptSeed],
    programId,
  );
}

export function deriveReferralConfigPda(
  referrer: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [REFERRAL_CONFIG_SEED, referrer.toBuffer()],
    programId,
  );
}

export function deriveTreeConfigPda(
  merkleTree: PublicKey,
  bubblegumProgramId: PublicKey = BUBBLEGUM_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    bubblegumProgramId,
  );
}

export function getTreeConfigPDA(merkleTree: PublicKey): PublicKey {
  return deriveTreeConfigPda(merkleTree, BUBBLEGUM_PROGRAM_ID)[0];
}

export function shortPubkey(pk: PublicKey | string, chars = 4): string {
  const s = pk.toString();
  return `${s.slice(0, chars)}...${s.slice(-chars)}`;
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddr(addr: PublicKey | string): string {
  return `https://explorer.solana.com/address/${addr.toString()}?cluster=devnet`;
}

export async function getSolBalance(pubkey: PublicKey): Promise<number> {
  const connection = getConnection();
  const lamports = await connection.getBalance(pubkey);
  return lamports / 1e9;
}
