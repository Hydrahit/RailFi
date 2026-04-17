import crypto from "crypto";
import { Webhook } from "standardwebhooks";
import { stageDodoIntentFromWebhook } from "@/lib/dodo-intents";
import { publishWorkerJob, isQstashConfigured } from "@/lib/qstash";
import { getServerRedis } from "@/lib/upstash";
import { createRetryJob, ingestWebhookEvent, markWebhookFailed } from "@/lib/webhook-inbox";
import type {
  DodoWebhookPayload,
} from "@/types/dodo";

export const runtime = "nodejs";

function getRedis() {
  return getServerRedis("dodo webhook");
}

function getWebhookVerifier(): Webhook {
  const secret = process.env.DODO_WEBHOOK_SECRET?.trim();

  if (!secret) {
    throw new Error("DODO_WEBHOOK_SECRET is not configured");
  }

  return new Webhook(secret);
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const webhookId = request.headers.get("webhook-id") ?? "";
  const webhookSignature = request.headers.get("webhook-signature") ?? "";
  const webhookTimestamp = request.headers.get("webhook-timestamp") ?? "";

  let payload: DodoWebhookPayload;
  try {
    payload = getWebhookVerifier().verify(rawBody, {
      "webhook-id": webhookId,
      "webhook-signature": webhookSignature,
      "webhook-timestamp": webhookTimestamp,
    }) as DodoWebhookPayload;
  } catch (error: unknown) {
    console.error("[dodo/webhook] Verification failed", error);
    return new Response("Unauthorized", { status: 401 });
  }

  if (payload.event_type !== "payment.succeeded") {
    return Response.json({ received: true });
  }

  const eventKey =
    payload.data.payment_id?.trim() ||
    payload.webhook_id?.trim() ||
    request.headers.get("webhook-id")?.trim() ||
    crypto.randomUUID();
  const inbox = await ingestWebhookEvent({
    provider: "dodo",
    sourcePath: "/api/webhooks/dodo",
    eventKey,
    eventType: payload.event_type,
    payload: payload as never,
  });

  try {
    if (isQstashConfigured() && inbox) {
      await publishWorkerJob(
        "dodo-webhook",
        {
          inboxId: inbox.id,
          eventKey,
        },
        { retries: 5 },
      );
      await createRetryJob({
        kind: "webhook-process",
        resourceType: "webhook_inbox",
        resourceId: inbox.id,
        inboxId: inbox.id,
        payload: { provider: "dodo", eventKey },
      });
    } else {
      const { duplicate, intent } = await stageDodoIntentFromWebhook(payload);

      if (duplicate) {
        console.info("[dodo/webhook] Duplicate event for payment_id, skipping", { payment_id: payload.data.payment_id });
      } else if (intent) {
        console.info("[dodo/webhook] Intent staged inline", {
          payment_id: intent.dodoPaymentId,
          amountUsd: intent.amountUsd,
          email: intent.customerEmail,
        });
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to enqueue Dodo webhook.";
    if (inbox) {
      await markWebhookFailed(inbox.id, message);
    }
    console.error("[dodo/webhook] Failed to ingest webhook", { eventKey, error });
    return Response.json({ error: "Webhook ingestion failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
