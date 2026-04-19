import { randomUUID } from "crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest } from "next/server";
import { auth } from "../../../../../auth";
import { POST as relayPreparePost } from "@/app/api/relay/prepare/route";
import { POST as relaySubmitPost } from "@/app/api/relay/submit/route";
import { atomicPayoutStateTransition } from "@/lib/atomic-operations";
import { mirrorDodoSettlementAudit } from "@/lib/dodo-audit";
import { acquireLock, refreshLock, releaseLock } from "@/lib/redis-lock";
import { getServerRedis } from "@/lib/upstash";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import type { RelayPrepareResponse, RelaySubmitResponse, TriggerOfframpRelayAction } from "@/lib/relayer/types";
import type { DodoOfframpIntent } from "@/types/dodo";

export const runtime = "nodejs";

interface ExecuteRequestBody {
  dodoPaymentId: string;
}

interface RelaySuccessPayload {
  error?: string;
}

const EXECUTION_LOCK_TTL_SECONDS = 120;

function getRedis() {
  return getServerRedis("dodo execute");
}

function getExecuteLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getServerRedis("dodo execute rate limiting"),
    limiter: Ratelimit.slidingWindow(3, "60 s"),
    prefix: "railfi:ratelimit:dodo-execute:wallet",
    analytics: false,
  });
}

function cloneRelayHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return headers;
}

function buildInternalRequest(
  request: Request,
  pathname: string,
  body: object,
): NextRequest {
  const url = new URL(pathname, request.url);
  return new NextRequest(url, {
    method: "POST",
    headers: cloneRelayHeaders(request),
    body: JSON.stringify(body),
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function restoreReadyForRelayIntent(
  intentKey: string,
  currentIntent: DodoOfframpIntent,
  lockToken: string,
  errorMessage: string,
): Promise<void> {
  const redis = getRedis();
  const latest = await redis.get<DodoOfframpIntent>(intentKey);

  if (!latest || latest.executionLockToken !== lockToken) {
    return;
  }

  const restoredIntent: DodoOfframpIntent = {
    ...currentIntent,
    status: "READY_FOR_RELAY",
    executionLockToken: undefined,
    executionStartedAt: undefined,
    failureReason: errorMessage,
    lastExecutionError: errorMessage,
    retryCount: (currentIntent.retryCount ?? 0) + 1,
    lastRetryAt: Date.now(),
  };

  await redis.setex(intentKey, 86400, restoredIntent satisfies DodoOfframpIntent);

  try {
    await mirrorDodoSettlementAudit(restoredIntent);
  } catch (error) {
    console.error("[dodo/execute] Failed to mirror restored intent", {
      dodoPaymentId: restoredIntent.dodoPaymentId,
      error,
    });
  }
}

function getErrorMessage(payload: RelaySuccessPayload | null, fallback: string): string {
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  return fallback;
}

async function callRelayPrepare(
  request: Request,
  intent: DodoOfframpIntent,
): Promise<RelayPrepareResponse | Response> {
  const action: TriggerOfframpRelayAction = {
    kind: "trigger_offramp",
    userPubkey: intent.walletAddress!,
    amountMicroUsdc: String(intent.usdcAmount!),
    upiId: intent.upiHandle!,
    inrPaise: String(intent.inrQuote!),
    referralPubkey: null,
  };

  const relayResponse = await relayPreparePost(
    buildInternalRequest(request, "/api/relay/prepare", { action }),
  );
  const payload = await parseJsonResponse<RelayPrepareResponse & RelaySuccessPayload>(relayResponse);

  if (!relayResponse.ok) {
    return Response.json(
      { error: getErrorMessage(payload, "Relay preparation failed.") },
      { status: relayResponse.status },
    );
  }

  if (
    !payload ||
    typeof payload.serializedTransaction !== "string" ||
    payload.serializedTransaction.trim() === "" ||
    !Number.isInteger(payload.lastValidBlockHeight) ||
    payload.lastValidBlockHeight <= 0
  ) {
    return Response.json(
      { error: "Relay prepare returned an invalid response." },
      { status: 502 },
    );
  }

  return payload;
}

async function callRelaySubmit(
  request: Request,
  prepared: RelayPrepareResponse,
): Promise<RelaySubmitResponse | Response> {
  const relayResponse = await relaySubmitPost(
    buildInternalRequest(request, "/api/relay/submit", prepared),
  );
  const payload = await parseJsonResponse<RelaySubmitResponse & RelaySuccessPayload>(relayResponse);

  if (!relayResponse.ok) {
    return Response.json(
      { error: getErrorMessage(payload, "Relay submission failed.") },
      { status: relayResponse.status },
    );
  }

  if (
    !payload ||
    typeof payload.signature !== "string" ||
    payload.signature.trim() === "" ||
    typeof payload.payoutTransferId !== "string" ||
    payload.payoutTransferId.trim() === ""
  ) {
    return Response.json(
      { error: "Relay submit returned an invalid response." },
      { status: 502 },
    );
  }

  return payload;
}

export async function POST(request: NextRequest): Promise<Response> {
  const [session, walletSession] = await Promise.all([
    auth(),
    getRefreshedWalletSessionFromRequest(request),
  ]);

  if (!session?.user?.email) {
    return Response.json(
      {
        error:
          "Google sign-in required. Sign in with the Dodo customer email before executing this payout.",
      },
      { status: 401 },
    );
  }

  const walletAddress = session.user.walletAddress ?? walletSession?.walletAddress ?? null;

  if (!walletAddress) {
    return Response.json(
      {
        error:
          "Wallet session required. Connect your Solana wallet and approve the signature before executing this payout.",
      },
      { status: 403 },
    );
  }

  const rateLimit = await getExecuteLimiter().limit(walletAddress.trim().toLowerCase());

  if (!rateLimit.success) {
    return Response.json(
      { error: "Too many execution requests. Please wait." },
      { status: 429 },
    );
  }

  let body: ExecuteRequestBody;
  try {
    body = (await request.json()) as ExecuteRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dodoPaymentId = body.dodoPaymentId?.trim();

  if (!dodoPaymentId) {
    return Response.json({ error: "dodoPaymentId is required" }, { status: 400 });
  }

  const redis = getRedis();
  const intentKey = `railfi:dodo:intent:${dodoPaymentId}`;
  const lockKey = `railfi:dodo:lock:${dodoPaymentId}`;
  const lockToken = randomUUID();
  const lockAcquired = await acquireLock(lockKey, lockToken, EXECUTION_LOCK_TTL_SECONDS);

  if (!lockAcquired) {
    return Response.json(
      { error: "Payment already being processed" },
      { status: 409 },
    );
  }

  try {
    const intent = await redis.get<DodoOfframpIntent>(intentKey);

    if (!intent) {
      return Response.json(
        { error: "Payment intent not found or has expired." },
        { status: 404 },
      );
    }

    if (intent.status !== "READY_FOR_RELAY") {
      return Response.json(
        {
          error: `Cannot execute: intent is in status "${intent.status}".`,
          transferId: intent.transferId ?? null,
          solanaTx: intent.solanaTx ?? null,
        },
        { status: 409 },
      );
    }

    if (intent.walletAddress !== walletAddress) {
      console.warn("[dodo/execute] Wallet mismatch attempt", {
        sessionWallet: walletAddress,
        intentWallet: intent.walletAddress,
      });
      return new Response("Forbidden", { status: 403 });
    }

    if (
      !intent.upiHandle ||
      typeof intent.usdcAmount !== "number" ||
      typeof intent.inrQuote !== "number" ||
      !intent.walletAddress
    ) {
      return Response.json(
        { error: "Intent is incomplete. Claim step must be completed first." },
        { status: 422 },
      );
    }

    const executingIntent: DodoOfframpIntent = {
      ...intent,
      status: "RELAY_EXECUTING",
      executionLockToken: lockToken,
      executionStartedAt: Date.now(),
      lastExecutionError: undefined,
    };

    await redis.setex(intentKey, 86400, executingIntent);
    await mirrorDodoSettlementAudit(executingIntent).catch((error) => {
      console.error("[dodo/execute] Failed to mirror executing intent", {
        dodoPaymentId: executingIntent.dodoPaymentId,
        error,
      });
    });

    const lockStillOwnedBeforePrepare = await refreshLock(
      lockKey,
      lockToken,
      EXECUTION_LOCK_TTL_SECONDS,
    );
    if (!lockStillOwnedBeforePrepare) {
      await restoreReadyForRelayIntent(
        intentKey,
        intent,
        lockToken,
        "Execution lock lost before relay preparation.",
      );
      return Response.json(
        { error: "Execution lock was lost before relay preparation completed." },
        { status: 409 },
      );
    }

    const prepared = await callRelayPrepare(request, executingIntent);
    if (prepared instanceof Response) {
      await restoreReadyForRelayIntent(
        intentKey,
        intent,
        lockToken,
        "Relay preparation failed.",
      );
      return prepared;
    }

    const lockStillOwnedBeforeSubmit = await refreshLock(
      lockKey,
      lockToken,
      EXECUTION_LOCK_TTL_SECONDS,
    );
    if (!lockStillOwnedBeforeSubmit) {
      await restoreReadyForRelayIntent(
        intentKey,
        intent,
        lockToken,
        "Execution lock lost before relay submission.",
      );
      return Response.json(
        { error: "Execution lock was lost before relay submission completed." },
        { status: 409 },
      );
    }

    const submitted = await callRelaySubmit(request, prepared);
    if (submitted instanceof Response) {
      const submittedPayload = await parseJsonResponse<RelaySuccessPayload>(submitted.clone());
      await restoreReadyForRelayIntent(
        intentKey,
        intent,
        lockToken,
        getErrorMessage(submittedPayload, "Relay submission failed."),
      );
      return submitted;
    }

    const payoutTransferId = submitted.payoutTransferId ?? undefined;

    if (payoutTransferId) {
      const transition = await atomicPayoutStateTransition({
        transferId: payoutTransferId,
        fromStatus: "ON_CHAIN_CONFIRMED",
        toStatus: "PAYOUT_PENDING",
        metadata: {
          dodoPaymentId: intent.dodoPaymentId,
          solanaTx: submitted.signature,
          initiatedAt: new Date().toISOString(),
        },
        performedBy: `user:${walletAddress}`,
      });

      if (
        !transition.ok &&
        transition.reason !== "record_not_found" &&
        transition.reason !== "state_mismatch"
      ) {
        console.error("[dodo/execute] Failed to record payout state transition", {
          dodoPaymentId: intent.dodoPaymentId,
          transferId: payoutTransferId,
          reason: transition.reason,
          error: transition.error,
        });
      }
    }

    const settledIntent: DodoOfframpIntent = {
      ...intent,
      status: "RELAY_SUBMITTED",
      executionLockToken: undefined,
      executionStartedAt: undefined,
      lastExecutionError: undefined,
      transferId: payoutTransferId,
      solanaTx: submitted.signature,
      executedAt: Date.now(),
    };

    await redis.setex(intentKey, 7 * 24 * 3600, settledIntent);

    try {
      await mirrorDodoSettlementAudit(settledIntent);
    } catch (error: unknown) {
      console.error("[dodo/execute] Failed to mirror settlement audit", {
        dodoPaymentId: settledIntent.dodoPaymentId,
        transferId: settledIntent.transferId ?? null,
        error,
      });
    }

    console.info("[dodo/execute] Relay submitted successfully", {
      dodoPaymentId: intent.dodoPaymentId,
      transferId: payoutTransferId ?? null,
      solanaTx: submitted.signature,
    });

    return Response.json({
      transferId: submitted.payoutTransferId,
      solanaTx: submitted.signature,
      status: "RELAY_SUBMITTED",
      message: "On-chain transaction confirmed. UPI payout is being processed.",
    });
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}
