import "server-only";

import { assertNoForbiddenPublicSecrets, getServerHeliusApiKey } from "@/lib/server-env";

const API_BASE = "https://api.helius.xyz/v0";
const API_KEY = getServerHeliusApiKey();

assertNoForbiddenPublicSecrets();

export interface HeliusWebhookRegistration {
  webhookID: string;
  webhookURL: string;
  accountAddresses: string[];
  transactionTypes: string[];
}

async function heliusRequest(path: string, options?: RequestInit): Promise<unknown> {
  const url = `${API_BASE}${path}?api-key=${API_KEY}`;
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Helius API error ${response.status}: ${body}`);
  }

  return response.json();
}

export async function getWebhooks(): Promise<HeliusWebhookRegistration[]> {
  return heliusRequest("/webhooks") as Promise<HeliusWebhookRegistration[]>;
}

export async function registerWebhook(
  appUrl: string,
  programId: string,
): Promise<{ webhookID: string }> {
  return heliusRequest("/webhooks", {
    method: "POST",
    body: JSON.stringify({
      webhookURL: `${appUrl}/api/webhooks/helius`,
      transactionTypes: ["ANY"],
      accountAddresses: [programId],
      webhookType: "enhanced",
      authHeader: process.env.HELIUS_WEBHOOK_SECRET,
    }),
  }) as Promise<{ webhookID: string }>;
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await heliusRequest(`/webhooks/${webhookId}`, { method: "DELETE" });
}
