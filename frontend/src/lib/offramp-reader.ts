import "server-only";

import { createHash } from "crypto";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/solana";
import type { HeliusEnhancedTransaction, HeliusInstructionData } from "@/types/helius";

const HELIUS_API_BASE = "https://api.helius.xyz/v0";
const PAGE_LIMIT = 100;
const CHUNK_SIZE = 100;
const OFFRAMP_REQUEST_MIN_DATA_LEN = 161;
const OFFRAMP_REQUEST_DISCRIMINATOR = createHash("sha256")
  .update("account:OfframpRequest")
  .digest()
  .subarray(0, 8);

export interface OnChainOfframpRecord {
  accountPubkey: string;
  signature: string;
  blockTime: number;
  user: string;
  vault: string;
  usdcAmountLamports: number;
  inrPaise: number;
  receiptId: number;
  destinationUpiHash: string;
  timestamp: number;
  lockedUsdcUsdPrice: number;
  priceExpo: number;
  priceLockedAt: number;
  priceConf: number;
}

interface CandidateMeta {
  signature: string;
  timestamp: number;
}

function getHeliusApiKey(): string {
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("HELIUS_API_KEY is not configured.");
  }
  return apiKey;
}

function getHeliusRpcUrl(): string {
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("HELIUS_RPC_URL is not configured.");
  }
  return rpcUrl;
}

let connectionSingleton: Connection | null = null;

function getConnection(): Connection {
  if (!connectionSingleton) {
    connectionSingleton = new Connection(getHeliusRpcUrl(), "confirmed");
  }
  return connectionSingleton;
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("failed to fetch") ||
    message.includes("err_connection_closed") ||
    message.includes("err_network_io_suspended") ||
    message.includes("fetch failed") ||
    message.includes("timed out")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry<T>(loader: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await loader();
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) {
        throw error;
      }

      await sleep(350 * 2 ** attempt);
      attempt += 1;
    }
  }
}

function collectProgramInstructionAccounts(
  instructions: HeliusInstructionData[],
  programId: string,
  target = new Set<string>(),
): Set<string> {
  for (const instruction of instructions) {
    if (instruction.programId === programId) {
      for (const account of instruction.accounts) {
        target.add(account);
      }
    }

    if (instruction.innerInstructions.length > 0) {
      collectProgramInstructionAccounts(instruction.innerInstructions, programId, target);
    }
  }

  return target;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function decodeOfframpRequest(
  accountPubkey: string,
  accountInfo: AccountInfo<Buffer>,
): Omit<OnChainOfframpRecord, "signature" | "blockTime"> | null {
  if (!accountInfo.owner.equals(PROGRAM_ID)) {
    return null;
  }

  const data = Buffer.from(accountInfo.data);
  if (data.length < OFFRAMP_REQUEST_MIN_DATA_LEN) {
    return null;
  }

  if (!data.subarray(0, 8).equals(OFFRAMP_REQUEST_DISCRIMINATOR)) {
    return null;
  }

  let offset = 8;
  const user = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const vault = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
  offset += 32;
  const usdcAmountLamports = Number(data.readBigUInt64LE(offset));
  offset += 8;
  const inrPaise = Number(data.readBigUInt64LE(offset));
  offset += 8;
  const receiptId = data.readUInt32LE(offset);
  offset += 4;
  const destinationUpiHash = data.subarray(offset, offset + 32).toString("hex");
  offset += 32;
  const timestamp = Number(data.readBigInt64LE(offset));
  offset += 8;
  const lockedUsdcUsdPrice = Number(data.readBigInt64LE(offset));
  offset += 8;
  const priceExpo = data.readInt32LE(offset);
  offset += 4;
  const priceLockedAt = Number(data.readBigInt64LE(offset));
  offset += 8;
  const priceConf = Number(data.readBigUInt64LE(offset));

  return {
    accountPubkey,
    user,
    vault,
    usdcAmountLamports,
    inrPaise,
    receiptId,
    destinationUpiHash,
    timestamp,
    lockedUsdcUsdPrice,
    priceExpo,
    priceLockedAt,
    priceConf,
  };
}

export function applyPythExponent(mantissa: number, expo: number): number {
  return mantissa * Math.pow(10, expo);
}

async function fetchTransactionPage(
  walletAddress: string,
  before?: string,
): Promise<HeliusEnhancedTransaction[]> {
  const params = new URLSearchParams({
    "api-key": getHeliusApiKey(),
    type: "ANY",
    limit: String(PAGE_LIMIT),
  });

  if (before) {
    params.set("before", before);
  }

  const url = `${HELIUS_API_BASE}/addresses/${walletAddress}/transactions?${params.toString()}`;

  return withRetry(async () => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Helius history request failed with ${response.status}`);
    }

    return (await response.json()) as HeliusEnhancedTransaction[];
  });
}

async function fetchAccountInfos(
  publicKeys: PublicKey[],
): Promise<Array<AccountInfo<Buffer> | null>> {
  return withRetry(() => getConnection().getMultipleAccountsInfo(publicKeys, "confirmed"));
}

export async function fetchOfframpHistory(
  walletAddress: string,
  fyStart: number,
  fyEnd: number,
): Promise<OnChainOfframpRecord[]> {
  const owner = new PublicKey(walletAddress).toBase58();
  const candidateMetaByAccount = new Map<string, CandidateMeta>();
  let before: string | undefined;

  while (true) {
    const page = await fetchTransactionPage(owner, before);
    if (page.length === 0) {
      break;
    }

    for (const transaction of page) {
      if (transaction.transactionError !== null) {
        continue;
      }

      if (transaction.timestamp < fyStart || transaction.timestamp > fyEnd) {
        continue;
      }

      const accounts = collectProgramInstructionAccounts(
        transaction.instructions,
        PROGRAM_ID.toBase58(),
      );

      if (accounts.size === 0) {
        continue;
      }

      for (const account of Array.from(accounts)) {
        if (!candidateMetaByAccount.has(account)) {
          candidateMetaByAccount.set(account, {
            signature: transaction.signature,
            timestamp: transaction.timestamp,
          });
        }
      }
    }

    const oldestTimestamp = page.reduce(
      (min, transaction) => Math.min(min, transaction.timestamp),
      Number.POSITIVE_INFINITY,
    );

    if (oldestTimestamp < fyStart) {
      break;
    }

    before = page[page.length - 1]?.signature;
    if (!before) {
      break;
    }
  }

  if (candidateMetaByAccount.size === 0) {
    return [];
  }

  const candidateKeys = Array.from(candidateMetaByAccount.keys(), (key) => new PublicKey(key));
  const chunks = chunkArray(candidateKeys, CHUNK_SIZE);
  const records: OnChainOfframpRecord[] = [];

  for (const chunk of chunks) {
    const accountInfos = await fetchAccountInfos(chunk);

    accountInfos.forEach((accountInfo, index) => {
      if (!accountInfo) {
        return;
      }

      const accountPubkey = chunk[index].toBase58();
      const meta = candidateMetaByAccount.get(accountPubkey);
      if (!meta) {
        return;
      }

      const decoded = decodeOfframpRequest(accountPubkey, accountInfo);
      if (!decoded || decoded.user !== owner) {
        return;
      }

      if (meta.timestamp < fyStart || meta.timestamp > fyEnd) {
        return;
      }

      records.push({
        ...decoded,
        signature: meta.signature,
        blockTime: meta.timestamp,
      });
    });
  }

  return records.sort((left, right) => left.blockTime - right.blockTime);
}
