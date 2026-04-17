import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type WebhookProvider = "dodo" | "cashfree" | "helius";
export type WebhookInboxStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED"
  | "DEAD_LETTERED";

interface IngestWebhookInput {
  provider: WebhookProvider;
  sourcePath: string;
  eventKey: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}

function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

export async function ingestWebhookEvent(input: IngestWebhookInput) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.webhookInbox.upsert({
    where: { eventKey: input.eventKey },
    create: {
      provider: input.provider,
      sourcePath: input.sourcePath,
      eventKey: input.eventKey,
      eventType: input.eventType,
      payload: input.payload,
      status: "RECEIVED",
    },
    update: {
      provider: input.provider,
      sourcePath: input.sourcePath,
      eventType: input.eventType,
      payload: input.payload,
    },
  });
}

export async function markWebhookProcessing(id: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.webhookInbox.update({
    where: { id },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      lastError: null,
    },
  });
}

export async function markWebhookProcessed(id: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.webhookInbox.update({
    where: { id },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      lastError: null,
    },
  });
}

export async function markWebhookFailed(id: string, errorMessage: string, deadLetter = false) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.webhookInbox.update({
    where: { id },
    data: {
      status: deadLetter ? "DEAD_LETTERED" : "FAILED",
      lastError: errorMessage,
      deadLetteredAt: deadLetter ? new Date() : null,
    },
  });
}

export async function createRetryJob(args: {
  kind: string;
  resourceType: string;
  resourceId: string;
  inboxId?: string;
  payload?: Prisma.InputJsonValue;
  nextRunAt?: Date;
  maxAttempts?: number;
}) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.retryJob.create({
    data: {
      kind: args.kind,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      inboxId: args.inboxId,
      payload: args.payload,
      nextRunAt: args.nextRunAt ?? new Date(),
      maxAttempts: args.maxAttempts ?? 5,
    },
  });
}

export async function markRetryJobAttempt(id: string, errorMessage?: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.retryJob.update({
    where: { id },
    data: {
      status: errorMessage ? "FAILED" : "PROCESSING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      lastError: errorMessage ?? null,
    },
  });
}

export async function completeRetryJob(id: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.retryJob.update({
    where: { id },
    data: {
      status: "COMPLETED",
      lastError: null,
      lastAttemptAt: new Date(),
    },
  });
}

export async function deadLetterRetryJob(id: string, errorMessage: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.retryJob.update({
    where: { id },
    data: {
      status: "DEAD_LETTERED",
      lastError: errorMessage,
      lastAttemptAt: new Date(),
    },
  });
}
