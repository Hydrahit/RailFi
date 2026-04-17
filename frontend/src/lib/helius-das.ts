import "server-only";

import { CONFIGURED_USDC_MINT, PROGRAM_ID as CHAIN_PROGRAM_ID } from "@/lib/solana";
import { getServerHeliusApiKey, getServerHeliusRpcUrl } from "@/lib/server-env";
import { getWebhookRecordsByWallet } from "@/lib/webhook-store";

const HELIUS_RPC = getServerHeliusRpcUrl();
const USDC_MINT = CONFIGURED_USDC_MINT.toBase58();
const PROGRAM_ID = CHAIN_PROGRAM_ID.toBase58();
const API_KEY = getServerHeliusApiKey();
const WARN_COOLDOWN_MS = 30_000;
const BALANCE_CACHE_TTL_MS = 10_000;
const HISTORY_CACHE_TTL_MS = 12_000;
const PERSISTED_CACHE_TTL_MS = 8_000;
const HELIUS_RPC_TIMEOUT_MS = 2_500;
const HELIUS_HISTORY_TIMEOUT_MS = 3_500;

const warningTimestamps = new Map<string, number>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

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
          `[Helius DAS] Serving stale cache for ${key} after upstream failure.`,
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

function toOfframpRecordStatus(status: string): "PENDING" | "COMPRESSED" | "FAILED" {
  if (status === "COMPRESSED" || status === "FAILED") {
    return status;
  }
  return "PENDING";
}

interface HeliusAddressTransaction {
  signature: string;
  timestamp: number;
  accountData: Array<{ account: string }>;
  tokenTransfers: Array<{ mint: string; tokenAmount: number }>;
  description: string;
}

async function rpcCall(method: string, params: unknown): Promise<unknown> {
  try {
    const key = `rpc:${method}:${JSON.stringify(params)}`;
    return await dedupeRequest(
      key,
      () =>
        withRetry(async () => {
          const response = await withTimeout(
            fetch(HELIUS_RPC, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
              cache: "no-store",
            }),
            HELIUS_RPC_TIMEOUT_MS,
            `RPC timeout after ${HELIUS_RPC_TIMEOUT_MS}ms`,
          );

          if (!response.ok) {
            throw new Error(`RPC error: ${response.status}`);
          }

          const json = (await response.json()) as { result?: unknown; error?: { message: string } };
          if (json.error) {
            throw new Error(json.error.message);
          }

          return json.result;
        }),
      BALANCE_CACHE_TTL_MS,
      { allowStaleOnError: true },
    );
  } catch (error) {
    const normalizedError = normalizeFetchError(error);
    if (
      normalizedError instanceof TypeError ||
      normalizedError.message.includes("Failed to fetch") ||
      normalizedError.message.includes("ERR_CONNECTION_CLOSED")
    ) {
      warnOnce(
        "helius-das-network",
        "[Helius DAS] RPC temporarily unavailable. Returning a safe fallback.",
      );
    } else {
      warnOnce(
        `helius-das-${method}`,
        `[Helius DAS] ${method} failed. Returning a safe fallback.`,
      );
    }
    throw normalizedError;
  }
}

export async function getWalletUsdcBalance(walletAddress: string): Promise<number> {
  try {
    const result = await dedupeRequest(
      `wallet-balance:${walletAddress}`,
      async () =>
        (await rpcCall("getTokenAccountsByOwner", [
          walletAddress,
          { mint: USDC_MINT },
          {
            encoding: "jsonParsed",
            commitment: "confirmed",
          },
        ])) as {
          value?: Array<{
            account?: {
              data?: {
                parsed?: {
                  info?: {
                    tokenAmount?: {
                      uiAmount?: number | null;
                      amount?: string;
                      decimals?: number;
                    };
                  };
                };
              };
            };
          }>;
        },
      BALANCE_CACHE_TTL_MS,
    );

    const tokenAccount = result.value?.[0]?.account?.data?.parsed?.info?.tokenAmount;
    if (!tokenAccount) {
      return 0;
    }

    if (typeof tokenAccount.uiAmount === "number") {
      return tokenAccount.uiAmount;
    }

    const amount = tokenAccount.amount ? Number(tokenAccount.amount) : 0;
    const decimals = tokenAccount.decimals ?? 6;
    return amount / Math.pow(10, decimals);
  } catch {
    return 0;
  }
}

export interface OfframpTxHistory {
  signature: string;
  timestamp: number;
  usdcAmount: number;
  status: "PENDING" | "SETTLED" | "FAILED";
  upiId: string;
  estimatedInr: number;
}

export interface PersistedCompressionRecord {
  requestId: string;
  walletAddress: string;
  usdcAmount: number;
  upiId: string;
  estimatedInr: number;
  receivedAt: number;
  signature: string;
  compressionStatus: "PENDING" | "COMPRESSED" | "FAILED";
  compressionSignature: string | null;
  compressionError: string | null;
}

export async function getOfframpHistory(walletAddress: string): Promise<OfframpTxHistory[]> {
  try {
    return await dedupeRequest(
      `offramp-history:${walletAddress}`,
      () =>
        withRetry(async () => {
          const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${API_KEY}&limit=20`;
          const response = await withTimeout(
            fetch(url, { cache: "no-store" }),
            HELIUS_HISTORY_TIMEOUT_MS,
            `History timeout after ${HELIUS_HISTORY_TIMEOUT_MS}ms`,
          );
          if (!response.ok) {
            throw new Error(`History response: ${response.status}`);
          }

          const transactions = (await response.json()) as HeliusAddressTransaction[];

          return transactions
            .filter((transaction) => transaction.accountData.some((item) => item.account === PROGRAM_ID))
            .map((transaction) => {
              const usdcTransfer = transaction.tokenTransfers.find(
                (transfer) => transfer.mint === USDC_MINT,
              );

              return {
                signature: transaction.signature,
                timestamp: transaction.timestamp,
                usdcAmount: usdcTransfer?.tokenAmount ?? 0,
                status: "PENDING" as const,
                upiId: "",
                estimatedInr: 0,
              };
            });
        }),
      HISTORY_CACHE_TTL_MS,
      { allowStaleOnError: true },
    );
  } catch (error) {
    const normalizedError = normalizeFetchError(error);
    if (
      normalizedError instanceof TypeError ||
      normalizedError.message.includes("Failed to fetch") ||
      normalizedError.message.includes("ERR_CONNECTION_CLOSED")
    ) {
      warnOnce(
        "helius-history-network",
        "[Helius DAS] History request dropped by RPC. Returning an empty history.",
      );
    } else {
      warnOnce(
        "helius-history-generic",
        "[Helius DAS] History request failed. Returning an empty history.",
      );
    }
    return [];
  }
}

export async function getPersistedCompressionRecords(
  walletAddress: string,
): Promise<PersistedCompressionRecord[]> {
  try {
    return await dedupeRequest(
      `persisted-records:${walletAddress}`,
      async () =>
        (await getWebhookRecordsByWallet(walletAddress)).map((record) => ({
          requestId: record.requestId,
          walletAddress: record.walletAddress,
          usdcAmount: record.usdcAmount,
          upiId: record.upiId,
          estimatedInr: record.estimatedInr,
          receivedAt: record.receivedAt,
          signature: record.signature,
          compressionStatus: toOfframpRecordStatus(record.compressionStatus ?? "PENDING"),
          compressionSignature: record.compressionSignature ?? null,
          compressionError: record.compressionError ?? null,
        })),
      PERSISTED_CACHE_TTL_MS,
      { allowStaleOnError: true },
    );
  } catch (error) {
    const normalizedError = normalizeFetchError(error);
    if (
      normalizedError instanceof TypeError ||
      normalizedError.message.includes("Failed to fetch") ||
      normalizedError.message.includes("ERR_CONNECTION_CLOSED")
    ) {
      warnOnce(
        "persisted-records-network",
        "[Helius Store] Persistent offramp record lookup dropped. Returning an empty list.",
      );
    } else {
      warnOnce(
        "persisted-records-generic",
        "[Helius Store] Persistent offramp record lookup failed. Returning an empty list.",
      );
    }
    return [];
  }
}
