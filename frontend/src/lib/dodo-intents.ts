import "server-only";

import { getServerRedis } from "@/lib/upstash";
import type { DodoOfframpIntent, DodoWebhookPayload } from "@/types/dodo";

function getRedis() {
  return getServerRedis("dodo intents");
}

export async function stageDodoIntentFromWebhook(payload: DodoWebhookPayload): Promise<{
  duplicate: boolean;
  intent: DodoOfframpIntent | null;
}> {
  if (payload.event_type !== "payment.succeeded") {
    return { duplicate: false, intent: null };
  }

  const { payment_id, customer, amount, currency, created_at } = payload.data;

  if (!payment_id || !customer?.email) {
    throw new Error("Malformed Dodo payment.succeeded payload.");
  }

  const redis = getRedis();
  const redisKey = `railfi:dodo:intent:${payment_id}`;
  const existing = await redis.get<DodoOfframpIntent>(redisKey);

  if (existing) {
    return { duplicate: true, intent: existing };
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
  return { duplicate: false, intent };
}
