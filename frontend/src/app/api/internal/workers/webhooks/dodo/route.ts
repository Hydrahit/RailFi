import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stageDodoIntentFromWebhook } from "@/lib/dodo-intents";
import { verifyQstashRequest } from "@/lib/qstash";
import {
  completeRetryJob,
  markRetryJobAttempt,
  markWebhookFailed,
  markWebhookProcessed,
  markWebhookProcessing,
} from "@/lib/webhook-inbox";
import type { DodoWebhookPayload } from "@/types/dodo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WorkerBody {
  inboxId: string;
  eventKey: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  if (process.env.QSTASH_TOKEN?.trim()) {
    const isValid = await verifyQstashRequest(request, rawBody).catch(() => false);
    if (!isValid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: WorkerBody;
  try {
    body = JSON.parse(rawBody) as WorkerBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inbox = await db.webhookInbox.findUnique({
    where: { id: body.inboxId },
  });

  if (!inbox) {
    return NextResponse.json({ error: "Inbox record not found." }, { status: 404 });
  }

  const retryJob = await db.retryJob.findFirst({
    where: {
      inboxId: inbox.id,
      kind: "webhook-process",
    },
    orderBy: { createdAt: "desc" },
  });

  await markWebhookProcessing(inbox.id);
  if (retryJob) {
    await markRetryJobAttempt(retryJob.id);
  }

  try {
    const payload = inbox.payload as unknown as DodoWebhookPayload;
    await stageDodoIntentFromWebhook(payload);
    await markWebhookProcessed(inbox.id);
    if (retryJob) {
      await completeRetryJob(retryJob.id);
    }
    return NextResponse.json({ processed: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Dodo webhook processing failed.";
    const deadLetter = retryJob ? retryJob.attemptCount + 1 >= retryJob.maxAttempts : false;
    await markWebhookFailed(inbox.id, message, deadLetter);
    if (retryJob) {
      if (deadLetter) {
        await db.retryJob.update({
          where: { id: retryJob.id },
          data: {
            status: "DEAD_LETTERED",
            lastError: message,
            lastAttemptAt: new Date(),
          },
        });
      } else {
        await db.retryJob.update({
          where: { id: retryJob.id },
          data: {
            status: "FAILED",
            lastError: message,
            lastAttemptAt: new Date(),
          },
        });
      }
    }
    throw error;
  }
}
