import "server-only";

import { createRpc, type Rpc } from "@lightprotocol/stateless.js";
import { PROGRAM_ID } from "@/lib/solana";
import { getServerLightRpcUrl, getServerSolanaRpcUrl } from "@/lib/server-env";

const SOLANA_RPC_URL = getServerSolanaRpcUrl();
const LIGHT_RPC_URL = getServerLightRpcUrl();
const WARN_COOLDOWN_MS = 30_000;
const LIGHT_RPC_CACHE_TTL_MS = 12_000;
const LIGHT_RPC_TIMEOUT_MS = 3_000;

let rpcInstance: Rpc | null = null;
const warningTimestamps = new Map<string, number>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

export function getLightRpc(): Rpc {
  if (!rpcInstance) {
    rpcInstance = createRpc(SOLANA_RPC_URL, LIGHT_RPC_URL);
  }
  return rpcInstance;
}

function warnOnce(key: string, message: string) {
  const now = Date.now();
  const last = warningTimestamps.get(key) ?? 0;
  if (now - last < WARN_COOLDOWN_MS) {
    return;
  }
  warningTimestamps.set(key, now);
  console.warn(message);
}

function normalizeFetchError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function isRetryableNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("failed to fetch") ||
    message.includes("err_connection_closed") ||
    message.includes("err_network_io_suspended") ||
    message.includes("networkerror")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      const normalizedError = normalizeFetchError(error);
      if (attempt >= retries || !isRetryableNetworkError(normalizedError)) {
        throw normalizedError;
      }

      const delayMs = 350 * 2 ** attempt;
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function dedupeRequest<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number,
  options?: {
    allowStaleOnError?: boolean;
  },
): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const inFlight = inFlightRequests.get(key);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const promise = loader()
    .then((value) => {
      responseCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      if (options?.allowStaleOnError && cached) {
        warnOnce(
          `stale-cache:${key}`,
          `[Light RPC] Serving stale cache for ${key} after upstream failure.`,
        );
        return cached.value as T;
      }
      throw error;
    })
    .finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, promise as Promise<unknown>);
  return promise;
}

export interface CompressedOfframpRecord {
  requestId: string;
  signature: string;
  hash: string;
  owner: string;
  usdcAmount: number;
  estimatedInrPaise: number;
  upiIdPartial: string;
  status: 0 | 1 | 2;
  createdAt: number;
}

const STATUS_MAP = {
  0: "PENDING",
  1: "SETTLED",
  2: "FAILED",
} as const;

function bytesToHex(bytes: number[]): string {
  return bytes
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCompressedOfframpRequests(
  ownerBase58: string,
): Promise<CompressedOfframpRecord[]> {
  const rpc = getLightRpc();
  const programId = PROGRAM_ID;

  try {
    return await dedupeRequest(
      `light-rpc:${ownerBase58}`,
      () =>
        withRetry(async () => {
          const accounts = await withTimeout(
            rpc.getCompressedAccountsByOwner(programId),
            LIGHT_RPC_TIMEOUT_MS,
            `Light RPC timeout after ${LIGHT_RPC_TIMEOUT_MS}ms`,
          );
          const records: CompressedOfframpRecord[] = [];

          for (const account of accounts.items) {
            if (!account.data?.data) {
              continue;
            }

            try {
              const json = new TextDecoder().decode(Uint8Array.from(account.data.data));
              const parsed = JSON.parse(json) as {
                request_id?: string;
                signature?: string;
                owner: string;
                usdc_amount: number;
                estimated_inr: number;
                upi_id_partial: string;
                status: 0 | 1 | 2;
                created_at: number;
              };

              if (parsed.owner !== ownerBase58) {
                continue;
              }

              records.push({
                requestId: parsed.request_id ?? "",
                signature: parsed.signature ?? "",
                hash: bytesToHex(account.hash),
                owner: parsed.owner,
                usdcAmount: parsed.usdc_amount / 1_000_000,
                estimatedInrPaise: parsed.estimated_inr,
                upiIdPartial: parsed.upi_id_partial,
                status: parsed.status,
                createdAt: parsed.created_at,
              });
            } catch {
              continue;
            }
          }

          return records.sort((a, b) => b.createdAt - a.createdAt);
        }),
      LIGHT_RPC_CACHE_TTL_MS,
      { allowStaleOnError: true },
    );
  } catch (error) {
    const normalizedError = normalizeFetchError(error);
    if (
      normalizedError instanceof TypeError ||
      normalizedError.message.includes("Failed to fetch") ||
      normalizedError.message.includes("ERR_CONNECTION_CLOSED") ||
      normalizedError.message.includes("ERR_NETWORK_IO_SUSPENDED") ||
      normalizedError.message.includes("429")
    ) {
      warnOnce(
        "light-rpc-network",
        "[Light RPC] Compressed account query temporarily unavailable. Returning an empty list.",
      );
    } else {
      warnOnce(
        "light-rpc-generic",
        "[Light RPC] Failed to fetch compressed accounts. Returning an empty list.",
      );
    }
    return [];
  }
}

export function statusLabel(status: 0 | 1 | 2): string {
  return STATUS_MAP[status];
}
