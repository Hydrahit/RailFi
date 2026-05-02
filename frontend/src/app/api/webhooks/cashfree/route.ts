import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  extractCashfreeStatus,
  extractCashfreeEventType,
  extractCashfreeTransferId,
  extractCashfreeUtr,
} from "@/lib/cashfree-webhooks";
import { processCashfreeWebhookPayload } from "@/lib/cashfree-webhook-processor";
import {
  atomicProcessCashfreeWebhook,
  isAlreadyProcessed,
} from "@/lib/atomic-operations";
import { mapCashfreeStatusToOfframpStatus, writeOfframpDeadLetter } from "@/lib/offramp-store";
import { getServerRedis } from "@/lib/upstash";
import { publishWorkerJob, isQstashConfigured } from "@/lib/qstash";
import {
  createRetryJob,
  ingestWebhookEvent,
  markWebhookFailed,
} from "@/lib/webhook-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) {
    return false;
  }

  const digestHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const digestBase64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

  return timingSafeMatches(digestHex, signature) || timingSafeMatches(digestBase64, signature);
}

function extractCashfreeEventTimestamp(payload: Record<string, unknown>, rawBody: string): string {
  const candidates = [
    payload.eventTimestamp,
    payload.event_time,
    payload.eventTime,
    (payload.data as Record<string, unknown> | undefined)?.eventTimestamp,
    (payload.data as Record<string, unknown> | undefined)?.event_time,
    (payload.data as Record<string, unknown> | undefined)?.eventTime,
  ];
  const found = candidates.find((value) => typeof value === "string" || typeof value === "number");
  if (typeof found === "string" && found.trim()) {
    return found.trim();
  }
  if (typeof found === "number" && Number.isFinite(found)) {
    return String(found);
  }
  return crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
}

async function writeRecoverableDlq(transferId: string, rawBody: string, error: unknown): Promise<void> {
  const redis = getServerRedis("cashfree webhook dlq");
  try {
    // CRITICAL: Persist failed webhook payloads for operator replay instead of losing payout state.
    await redis.set(`cashfree:webhook:dead:${transferId}`, JSON.stringify({ raw: rawBody, error: String(error), ts: Date.now() }), {
      ex: 60 * 60 * 24 * 30,
    });
    await redis.set(`offramp:dlq:${transferId}`, JSON.stringify({ raw: rawBody, receivedAt: Date.now() }), {
      ex: 60 * 60 * 24 * 30,
    });
  } catch (dlqWriteErr) {
    // CRITICAL: DLQ write failure is a data-loss event; log the full payload for recovery from log drains.
    console.error(
      JSON.stringify({
        severity: "CRITICAL",
        event: "CASHFREE_DLQ_WRITE_FAILED",
        transferId,
        rawPayload: rawBody,
        error: String(dlqWriteErr),
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature")?.trim() ?? null;
  if (!process.env.CASHFREE_WEBHOOK_SECRET) {
    return new NextResponse("Webhook not configured", { status: 503 });
  }

  if (!verifySignature(rawBody, signature)) {
    console.warn("[cashfree-webhook] Signature verification failed.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = extractCashfreeEventType(payload) ?? "UNKNOWN_EVENT";
  const transferId = extractCashfreeTransferId(payload);
  const eventTimestamp = extractCashfreeEventTimestamp(payload, rawBody);

  if (!transferId) {
    console.warn("[cashfree-webhook] Missing transferId.", { eventType });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const redis = getServerRedis("cashfree webhook idempotency");
  // SECURITY: Idempotency rejects duplicate Cashfree deliveries before any payout-state mutation.
  const eventKey = `cashfree:webhook:event:${transferId}:${eventTimestamp}`;
  const alreadyProcessed = await redis.get(eventKey);
  if (alreadyProcessed) {
    return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
  }

  const inboxEventKey = createCashfreeEventKey(transferId, eventType, rawBody);
  let inbox: Awaited<ReturnType<typeof ingestWebhookEvent>> | null = null;

  try {
    inbox = await ingestWebhookEvent({
      provider: "cashfree",
      sourcePath: "/api/webhooks/cashfree",
      eventKey: inboxEventKey,
      eventType,
      payload: payload as never,
    });

    if (isQstashConfigured() && inbox) {
      await publishWorkerJob(
        "cashfree-webhook",
        {
          inboxId: inbox.id,
          eventKey: inboxEventKey,
          transferId,
        },
        { retries: 5 },
      );
      await createRetryJob({
        kind: "webhook-process",
        resourceType: "webhook_inbox",
        resourceId: inbox.id,
        inboxId: inbox.id,
        payload: { provider: "cashfree", transferId, eventType },
      });
    } else if (inbox) {
      const rawStatus = extractCashfreeStatus(payload) ?? "UNKNOWN";
      const mappedStatus = mapCashfreeStatusToOfframpStatus(rawStatus);
      const internalStatus =
        mappedStatus === "FAILED" || mappedStatus === "REVERSED"
          ? "REQUIRES_REVIEW"
          : mappedStatus;
      const requiresReview =
        mappedStatus === "FAILED" || mappedStatus === "REVERSED";
      const utr = extractCashfreeUtr(payload);
      const idempotencyKey = `webhook:cashfree:${transferId}:${internalStatus}`;
      const { processed } = await isAlreadyProcessed(idempotencyKey);

      if (processed) {
        console.log(
          `[cashfree-webhook] Idempotent replay for ${transferId} - returning cached 200`,
        );
        return NextResponse.json({ received: true, replayed: true });
      }

      const result = await atomicProcessCashfreeWebhook({
        webhookId: inbox.id,
        transferId,
        newStatus: internalStatus,
        utr,
        requiresReview,
        rawPayload: rawBody,
      });

      if (!result.ok) {
        if (result.reason === "already_processed") {
          return NextResponse.json({ received: true });
        }
        if (result.reason === "record_not_found") {
          await writeOfframpDeadLetter(
            transferId,
            rawBody,
            "cashfree",
            "record_not_found_atomic",
          );
          return NextResponse.json({ received: true, queued: "dlq" });
        }
        console.error("[cashfree-webhook] Atomic operation failed:", result.error);
        return NextResponse.json({ error: "Processing failed" }, { status: 500 });
      }
    } else {
      await processCashfreeWebhookPayload(payload, rawBody);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to ingest Cashfree webhook.";
    if (inbox) {
      await markWebhookFailed(inbox.id, message);
    }
    await writeRecoverableDlq(transferId, rawBody, error);
    console.error("[cashfree-webhook] Failed to ingest webhook", {
      transferId,
      eventType,
      error,
    });
    return NextResponse.json({ ok: false, state: "DEAD_LETTERED" }, { status: 200 });
  } finally {
    // SECURITY: Terminal marker prevents webhook events from staying forever in a RECEIVED limbo state.
    await redis.set(eventKey, "PROCESSED", { ex: 60 * 60 * 24 * 7 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

function createCashfreeEventKey(transferId: string, eventType: string, rawBody: string): string {
  return crypto
    .createHash("sha256")
    .update(`${transferId}:${eventType}:${rawBody}`)
    .digest("hex");
}
