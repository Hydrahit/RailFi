import "server-only";

import { Client, Receiver } from "@upstash/qstash";
import { getAppUrl } from "@/lib/server-env";

type WorkerKind = "dodo-webhook" | "cashfree-webhook" | "reconcile";

const workerPathMap: Record<WorkerKind, string> = {
  "dodo-webhook": "/api/internal/workers/webhooks/dodo",
  "cashfree-webhook": "/api/internal/workers/webhooks/cashfree",
  reconcile: "/api/internal/workers/reconcile",
};

let qstashClient: Client | null = null;
let qstashReceiver: Receiver | null = null;

export function isQstashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN?.trim();
}

export function getQstashClient(): Client {
  if (!isQstashConfigured()) {
    throw new Error("QSTASH_TOKEN is not configured.");
  }

  qstashClient ??= new Client({
    token: process.env.QSTASH_TOKEN?.trim(),
  });

  return qstashClient;
}

export function getQstashReceiver(): Receiver {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();

  if (!currentSigningKey || !nextSigningKey) {
    throw new Error("QStash signing keys are not configured.");
  }

  qstashReceiver ??= new Receiver({
    currentSigningKey,
    nextSigningKey,
  });

  return qstashReceiver;
}

export async function verifyQstashRequest(request: Request, body: string): Promise<boolean> {
  const signature = request.headers.get("upstash-signature") ?? "";
  if (!signature) {
    return false;
  }

  return getQstashReceiver().verify({
    signature,
    body,
    url: request.url,
  });
}

export async function publishWorkerJob<TBody>(
  kind: WorkerKind,
  body: TBody,
  options?: { retries?: number; delay?: number | `${bigint}s` | `${bigint}m` | `${bigint}h` | `${bigint}d` },
): Promise<void> {
  const client = getQstashClient();
  const appUrl = getAppUrl();

  await client.publishJSON({
    url: `${appUrl}${workerPathMap[kind]}`,
    body,
    retries: options?.retries ?? 5,
    delay: options?.delay,
  });
}
