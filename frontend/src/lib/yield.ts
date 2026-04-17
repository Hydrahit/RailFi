import "server-only";

import { createHash } from "crypto";
import { cache } from "react";
import bs58 from "bs58";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { CONFIGURED_USDC_MINT, PROGRAM_ID, deriveProtocolConfigPda } from "@/lib/solana";
import { assertNoForbiddenPublicSecrets, getServerHeliusRpcUrl } from "@/lib/server-env";

const MAINNET_KAMINO_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECENT_SLOT_DURATION_MS = 400;
const ACCOUNT_BATCH_SIZE = 100;
const BENCHMARK_USD_INR = 83.5;
const CACHE_TTL_MS = 60_000;
const FALLBACK_APY_PERCENT = 5.5;
const FALLBACK_IDLE_TVL_USDC = 12_500;

const PROTOCOL_CONFIG_DISCRIMINATOR = createHash("sha256")
  .update("account:ProtocolConfig")
  .digest()
  .subarray(0, 8);
const USER_VAULT_DISCRIMINATOR = createHash("sha256")
  .update("account:UserVault")
  .digest()
  .subarray(0, 8);

export type YieldMode = "benchmark_only";

export interface YieldSnapshot {
  kaminoEnabled: boolean;
  apyBps: number;
  apyPercent: number;
  source: string;
  totalIdleTvlUsdc: number;
  projectedMonthlyYieldUsdc: number;
  projectedMonthlyYieldInr: number;
  benchmarkUsdInr: number;
  mode: YieldMode;
  generatedAt: string;
}

interface ProtocolConfigSnapshot {
  usdcMint: PublicKey;
  oracleMaxAge: bigint;
  kaminoEnabled: boolean;
}

let devnetConnectionSingleton: Connection | null = null;
let mainnetConnectionSingleton: Connection | null = null;
let cachedSnapshot:
  | {
      value: YieldSnapshot;
      expiresAt: number;
    }
  | null = null;

assertNoForbiddenPublicSecrets();

function getDevnetRpcUrl(): string {
  try {
    return getServerHeliusRpcUrl();
  } catch {
    return clusterApiUrl("devnet");
  }
}

function getMainnetRpcUrl(): string {
  return process.env.KAMINO_MAINNET_RPC_URL?.trim() || clusterApiUrl("mainnet-beta");
}

function getDevnetConnection(): Connection {
  if (!devnetConnectionSingleton) {
    devnetConnectionSingleton = new Connection(getDevnetRpcUrl(), "confirmed");
  }
  return devnetConnectionSingleton;
}

function getMainnetConnection(): Connection {
  if (!mainnetConnectionSingleton) {
    mainnetConnectionSingleton = new Connection(getMainnetRpcUrl(), "confirmed");
  }
  return mainnetConnectionSingleton;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function decodeProtocolConfig(data: Buffer): ProtocolConfigSnapshot {
  if (!data.subarray(0, 8).equals(PROTOCOL_CONFIG_DISCRIMINATOR)) {
    throw new Error(
      "Protocol config uses a stale pre-oracle layout. Re-run protocol migration or initialization with oracle_max_age before using the Yield dashboard.",
    );
  }

  const isCurrentLayout = data.length >= 178;
  const isOracleAwareLayout = data.length >= 146;

  if (!isCurrentLayout && !isOracleAwareLayout) {
    throw new Error(
      "Protocol config uses a stale pre-oracle layout. Re-run protocol migration or initialization with oracle_max_age before using the Yield dashboard.",
    );
  }

  let offset = 8;
  offset += 32; // admin
  if (isCurrentLayout) {
    offset += 32; // relayer_authority
  }
  const usdcMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 32; // merkle_tree
  offset += 32; // kyc_authority
  const oracleMaxAge = data.readBigUInt64LE(offset);
  offset += 8;
  const kaminoEnabled = data.readUInt8(offset) === 1;

  return { usdcMint, oracleMaxAge, kaminoEnabled };
}

function buildFallbackSnapshot(totalIdleTvlUsdc = FALLBACK_IDLE_TVL_USDC): YieldSnapshot {
  const apyPercent = FALLBACK_APY_PERCENT;
  const projectedMonthlyYieldUsdc = totalIdleTvlUsdc * (apyPercent / 100 / 12);
  const projectedMonthlyYieldInr = projectedMonthlyYieldUsdc * BENCHMARK_USD_INR;

  return {
    kaminoEnabled: false,
    apyBps: Math.round(apyPercent * 100),
    apyPercent,
    source: "Kamino benchmark fallback",
    totalIdleTvlUsdc,
    projectedMonthlyYieldUsdc,
    projectedMonthlyYieldInr,
    benchmarkUsdInr: BENCHMARK_USD_INR,
    mode: "benchmark_only",
    generatedAt: new Date().toISOString(),
  };
}

function isWasmModuleError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    (message.includes("enoent") && message.includes(".wasm")) ||
    message.includes("whirlpools") ||
    message.includes("orca__whirlpools__core")
  );
}

async function fetchProtocolConfigSnapshot(): Promise<ProtocolConfigSnapshot> {
  const [protocolConfigPda] = deriveProtocolConfigPda(PROGRAM_ID);
  const accountInfo = await getDevnetConnection().getAccountInfo(protocolConfigPda, "confirmed");

  if (!accountInfo) {
    throw new Error(
      "Protocol config is missing. Re-run protocol initialization with oracle_max_age before using the Yield dashboard.",
    );
  }

  return decodeProtocolConfig(Buffer.from(accountInfo.data));
}

function decodeTokenAmount(data: Buffer): bigint {
  if (data.length < 72) {
    return BigInt(0);
  }
  return data.readBigUInt64LE(64);
}

async function fetchTotalIdleTvlUsdc(usdcMint: PublicKey): Promise<number> {
  const vaultAccounts = await getDevnetConnection().getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: bs58.encode(USER_VAULT_DISCRIMINATOR) } }],
  });

  if (vaultAccounts.length === 0) {
    return 0;
  }

  const vaultAtas = vaultAccounts.map(({ pubkey }) =>
    getAssociatedTokenAddressSync(usdcMint, pubkey, true),
  );

  let totalMicroUsdc = BigInt(0);

  for (const chunk of chunkArray(vaultAtas, ACCOUNT_BATCH_SIZE)) {
    const accounts = await getDevnetConnection().getMultipleAccountsInfo(chunk, "confirmed");

    for (const account of accounts) {
      if (!account || !account.owner.equals(TOKEN_PROGRAM_ID)) {
        continue;
      }
      totalMicroUsdc += decodeTokenAmount(Buffer.from(account.data));
    }
  }

  return Number(totalMicroUsdc) / 1_000_000;
}

async function fetchKaminoUsdcApyPercent(): Promise<number> {
  const { KaminoMarket } = await import("@kamino-finance/klend-sdk");
  const mainnetConnection = getMainnetConnection();
  const market = await KaminoMarket.load(
    mainnetConnection as never,
    MAINNET_KAMINO_MARKET as never,
    RECENT_SLOT_DURATION_MS,
    undefined,
    true,
  );

  if (!market) {
    throw new Error("Failed to load the Kamino main market.");
  }

  await market.loadReserves();

  const reserve =
    market.getReserveByMint(MAINNET_USDC_MINT as never) ??
    market.getReserveBySymbol("USDC");

  if (!reserve) {
    throw new Error("Kamino USDC reserve is unavailable.");
  }

  const currentSlot = await mainnetConnection.getSlot("confirmed");
  const apyDecimal = reserve.totalSupplyAPY(currentSlot as never);
  return apyDecimal * 100;
}

export const getYieldSnapshot = cache(async (): Promise<YieldSnapshot> => {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) {
    return cachedSnapshot.value;
  }

  const protocolConfig = await fetchProtocolConfigSnapshot();
  const usdcMint = protocolConfig.usdcMint || CONFIGURED_USDC_MINT;
  let totalIdleTvlUsdc = FALLBACK_IDLE_TVL_USDC;

  try {
    totalIdleTvlUsdc = await fetchTotalIdleTvlUsdc(usdcMint);
  } catch (error) {
    console.warn("[yield] Failed to load idle TVL; using fallback benchmark TVL.", error);
  }

  let apyPercent: number;
  try {
    apyPercent = await fetchKaminoUsdcApyPercent();
  } catch (error) {
    if (!isWasmModuleError(error)) {
      throw error;
    }

    console.warn("[yield] Orca/Kamino WASM unavailable; returning fallback benchmark snapshot.", error);
    const fallbackSnapshot = buildFallbackSnapshot(totalIdleTvlUsdc);
    cachedSnapshot = {
      value: fallbackSnapshot,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return fallbackSnapshot;
  }

  const projectedMonthlyYieldUsdc = totalIdleTvlUsdc * (apyPercent / 100 / 12);
  const projectedMonthlyYieldInr = projectedMonthlyYieldUsdc * BENCHMARK_USD_INR;
  const snapshot: YieldSnapshot = {
    kaminoEnabled: protocolConfig.kaminoEnabled,
    apyBps: Math.round(apyPercent * 100),
    apyPercent,
    source: "Kamino Mainnet USDC",
    totalIdleTvlUsdc,
    projectedMonthlyYieldUsdc,
    projectedMonthlyYieldInr,
    benchmarkUsdInr: BENCHMARK_USD_INR,
    mode: "benchmark_only",
    generatedAt: new Date().toISOString(),
  };

  cachedSnapshot = {
    value: snapshot,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return snapshot;
});

export function getYieldFallbackSnapshot(): YieldSnapshot {
  return buildFallbackSnapshot();
}
