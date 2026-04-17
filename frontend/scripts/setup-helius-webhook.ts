const dotenv = require("dotenv") as typeof import("dotenv");
dotenv.config({ path: ".env.local" });

const API_BASE = "https://api.helius.xyz/v0";
const API_KEY = process.env.HELIUS_API_KEY;

interface HeliusWebhookRegistration {
  webhookID: string;
  webhookURL: string;
  accountAddresses: string[];
  transactionTypes: string[];
}

async function heliusRequest(path: string, options?: RequestInit): Promise<unknown> {
  if (!API_KEY) {
    throw new Error("Missing HELIUS_API_KEY in .env.local");
  }

  const response = await fetch(`${API_BASE}${path}?api-key=${API_KEY}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Helius API error ${response.status}: ${body}`);
  }

  return response.json();
}

async function getWebhooks(): Promise<HeliusWebhookRegistration[]> {
  return heliusRequest("/webhooks") as Promise<HeliusWebhookRegistration[]>;
}

async function registerWebhook(
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

async function main(): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;

  if (!appUrl || !programId) {
    console.error("Missing NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_PROGRAM_ID in .env.local");
    process.exit(1);
  }

  const webhookUrl = `${appUrl}/api/webhooks/helius`;
  console.log(`Checking for existing webhook at: ${webhookUrl}`);

  const existing = await getWebhooks();
  const found = existing.find((webhook) => webhook.webhookURL === webhookUrl);

  if (found) {
    console.log(`Webhook already registered: ${found.webhookID}`);
    process.exit(0);
  }

  const result = await registerWebhook(appUrl, programId);
  console.log(`Webhook registered successfully. ID: ${result.webhookID}`);
}

void main().catch((error: unknown) => {
  console.error("Setup failed:", error);
  process.exit(1);
});

export {};
