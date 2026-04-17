import { Webhook } from "standardwebhooks";
import { getServerRedis } from "@/lib/upstash";
import type {
  DodoWebhookPayload,
  DodoOfframpIntent,
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

  const { payment_id, customer, amount, currency, created_at } = payload.data;

  if (!payment_id || !customer?.email) {
    console.error("[dodo/webhook] Malformed payment.succeeded payload", {
      payment_id,
    });
    return Response.json({ received: true });
  }

  const redis = getRedis();
  const redisKey = `railfi:dodo:intent:${payment_id}`;
  const existing = await redis.get<DodoOfframpIntent>(redisKey);

  if (existing !== null) {
    console.info("[dodo/webhook] Duplicate event for payment_id, skipping", {
      payment_id,
    });
    return Response.json({ received: true });
  }

  const intent: DodoOfframpIntent = {
    dodoPaymentId: payment_id,
    customerEmail: customer.email,
    customerName: customer.name ?? "",
    amountUsd: amount / 100,
    currency,
    status: "PENDING_WALLET_LINK",
    createdAt: new Date(created_at).getTime(),
  };

  await redis.setex(redisKey, 3600, intent);

  console.info("[dodo/webhook] Intent staged", {
    payment_id,
    amountUsd: intent.amountUsd,
    email: intent.customerEmail,
  });

  return Response.json({ received: true });
}
