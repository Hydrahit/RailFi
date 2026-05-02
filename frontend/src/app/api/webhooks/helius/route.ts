import { BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import { NextRequest, NextResponse } from "next/server";
import rawIdl from "@/idl/railpay.json";
import type { HeliusEnhancedTransaction, OfframpRecord } from "@/types/helius";
import {
  appendWebhookEvent,
  getWebhookRecordsByWallet,
  upsertWebhookRecord,
} from "@/lib/webhook-store";
import { CONFIGURED_USDC_MINT, PROGRAM_ID } from "@/lib/solana";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { enforceWalletRateLimit } from "@/lib/rate-limit";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { getServerRedis } from "@/lib/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMPRESSION_TIMEOUT_MS = 8_000;
const TRIGGER_OFFRAMP_USER_ACCOUNT_INDEX = 2;
const idl = rawIdl as Idl;
const coder = new BorshInstructionCoder(idl);

function findTriggerOfframpUserWallet(
  instructions: HeliusEnhancedTransaction["instructions"],
): string | null {
  for (const instruction of instructions) {
    if (instruction.programId === PROGRAM_ID.toBase58()) {
      try {
        const decoded = coder.decode(instruction.data, "base58");
        if (decoded?.name === "triggerOfframp") {
          return instruction.accounts[TRIGGER_OFFRAMP_USER_ACCOUNT_INDEX] ?? null;
        }
      } catch (error) {
        console.warn("[Helius Webhook] Failed to decode RailFi instruction.", {
          programId: instruction.programId,
          error,
        });
      }
    }

    const nestedMatch = findTriggerOfframpUserWallet(instruction.innerInstructions ?? []);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "heliusWebhookIp",
    "Helius webhook rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  const authHeader = request.headers.get("Authorization");
  const configuredSecret = process.env.HELIUS_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) {
    console.error("[Helius Webhook] HELIUS_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook authentication is not configured." }, { status: 503 });
  }

  const internalApiToken = process.env.INTERNAL_API_TOKEN?.trim();
  if (!internalApiToken) {
    console.error("[Helius Webhook] INTERNAL_API_TOKEN is not configured.");
  }

  if (authHeader !== configuredSecret) {
    console.warn("[Helius Webhook] Unauthorized webhook request.", {
      hasAuthorizationHeader: Boolean(authHeader),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let transactions: HeliusEnhancedTransaction[];
  try {
    transactions = (await request.json()) as HeliusEnhancedTransaction[];
  } catch {
    console.error("[Helius Webhook] Failed to parse webhook JSON body.");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await appendWebhookEvent(transactions);
  } catch (error) {
    console.error("[Helius Webhook] Failed to append raw webhook payload.", {
      error,
      transactionCount: transactions.length,
    });
    return NextResponse.json({ error: "Failed to append webhook event." }, { status: 500 });
  }

  for (const transaction of transactions) {
    const isRelevant = transaction.accountData.some(
      (account) => account.account === PROGRAM_ID.toBase58(),
    );
    if (!isRelevant) {
      continue;
    }

    const usdcTransfer = transaction.tokenTransfers.find(
      (transfer) => transfer.mint === CONFIGURED_USDC_MINT.toBase58(),
    );
    const walletAddress = findTriggerOfframpUserWallet(transaction.instructions) ?? transaction.feePayer;

    const record: OfframpRecord = {
      requestId: transaction.signature,
      walletAddress,
      usdcAmount: usdcTransfer?.tokenAmount ?? 0,
      upiId: "",
      lockedRate: 0,
      estimatedInr: 0,
      status: "PENDING",
      compressionStatus: "PENDING",
      compressionSignature: null,
      compressionError: null,
      receivedAt: transaction.timestamp,
      signature: transaction.signature,
    };

    try {
      await upsertWebhookRecord(record);
    } catch (error) {
      console.error("[Helius Webhook] Failed to persist offramp record.", {
        requestId: record.requestId,
        walletAddress: record.walletAddress,
        error,
      });
      return NextResponse.json({ error: "Failed to persist webhook record." }, { status: 500 });
    }
    console.log(
      `[Helius Webhook] Processed offramp: ${record.requestId} from ${record.walletAddress}`,
    );

    const listKey = `helius:events:${walletAddress}`;
    const redis = getServerRedis("helius wallet event log");
    // RESILIENCE: Bounded per-wallet event log prevents Redis memory exhaustion on high-volume wallets.
    await redis.lpush(listKey, JSON.stringify(record));
    await redis.ltrim(listKey, 0, 499);
    await redis.expire(listKey, 60 * 60 * 24 * 30);

    if (!internalApiToken) {
      await upsertWebhookRecord({
        ...record,
        compressionStatus: "FAILED",
        compressionSignature: null,
        compressionError: "INTERNAL_API_TOKEN is not configured.",
      });
      continue;
    }

    const compressionController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const compressionPromise = fetch(
        `${request.nextUrl.origin}/api/compress-offramp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Token": internalApiToken ?? "",
          },
          body: JSON.stringify({
            request_id: record.requestId,
            signature: record.signature,
            owner: record.walletAddress,
            usdc_amount: Math.round(record.usdcAmount * 1_000_000),
            estimated_inr: record.estimatedInr,
            upi_id_partial: record.upiId.substring(0, 10),
            status: 0,
            created_at: record.receivedAt,
          }),
          signal: compressionController.signal,
        },
      ).then(async (response) => {
        const payload = (await response.json()) as
          | { success: true; signature: string }
          | { success: false; error: string };

        if (!response.ok || !payload.success) {
          throw new Error(
            "error" in payload ? payload.error : `Compression failed with ${response.status}`,
          );
        }

        return payload.signature;
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          compressionController.abort();
          reject(new Error("Compression request timed out after 8 seconds"));
        }, COMPRESSION_TIMEOUT_MS);
      });

      const compressionSignature = await Promise.race([
        compressionPromise,
        timeoutPromise,
      ]);

      await upsertWebhookRecord({
        ...record,
        compressionStatus: "COMPRESSED",
        compressionSignature,
        compressionError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compression failed";
      await upsertWebhookRecord({
        ...record,
        compressionStatus: "FAILED",
        compressionSignature: null,
        compressionError: message,
      });
      console.warn("[Compress] Compression did not complete:", message);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  return NextResponse.json({ received: true });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getRefreshedWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const walletLimit = await enforceWalletRateLimit(
      session.walletAddress,
      "webhookArchiveWallet",
      "Webhook archive lookup rate limit exceeded for this wallet.",
    );
    if (!walletLimit.allowed) {
      return NextResponse.json({ error: walletLimit.message }, { status: 429 });
    }

    const records = await getWebhookRecordsByWallet(session.walletAddress);
    const response = NextResponse.json({ records }, { status: 200 });
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    console.error("[Helius Webhook] Persistent offramp record lookup failed.", {
      wallet: "session_scoped",
      error,
      hasRedisUrl: Boolean(process.env.UPSTASH_REDIS_REST_URL?.trim()),
      hasRedisToken: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN?.trim()),
    });
    return NextResponse.json({ error: "Failed to load webhook records." }, { status: 500 });
  }
}
