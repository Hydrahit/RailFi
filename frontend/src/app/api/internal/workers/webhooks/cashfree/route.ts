import { NextRequest, NextResponse } from "next/server";
import {
  atomicProcessCashfreeWebhook,
  isAlreadyProcessed,
} from "@/lib/atomic-operations";
import { db } from "@/lib/db";
import { extractCashfreeStatus, extractCashfreeUtr } from "@/lib/cashfree-webhooks";
import { mapCashfreeStatusToOfframpStatus, writeOfframpDeadLetter } from "@/lib/offramp-store";
import { requireInternalAuth } from "@/lib/internal-auth";
import {
  completeRetryJob,
  markRetryJobAttempt,
  markWebhookFailed,
  markWebhookProcessed,
  markWebhookProcessing,
} from "@/lib/webhook-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WorkerBody {
  inboxId: string;
  eventKey: string;
  transferId: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const auth = await requireInternalAuth(request, rawBody);
  if (!auth.ok) {
    return auth.response;
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
    const payload = inbox.payload as Record<string, unknown>;
    const rawPayload = JSON.stringify(inbox.payload);
    const rawStatus = extractCashfreeStatus(payload) ?? "UNKNOWN";
    const mappedStatus = mapCashfreeStatusToOfframpStatus(rawStatus);
    const internalStatus =
      mappedStatus === "FAILED" || mappedStatus === "REVERSED"
        ? "REQUIRES_REVIEW"
        : mappedStatus;
    const requiresReview =
      mappedStatus === "FAILED" || mappedStatus === "REVERSED";
    const utr = extractCashfreeUtr(payload);
    const idempotencyKey = `webhook:cashfree:${body.transferId}:${internalStatus}`;
    const { processed } = await isAlreadyProcessed(idempotencyKey);

    if (processed) {
      await markWebhookProcessed(inbox.id);
      if (retryJob) {
        await completeRetryJob(retryJob.id);
      }
      return NextResponse.json({ processed: true, replayed: true }, { status: 200 });
    }

    const result = await atomicProcessCashfreeWebhook({
      webhookId: inbox.id,
      transferId: body.transferId,
      newStatus: internalStatus,
      utr,
      requiresReview,
      rawPayload,
    });

    if (!result.ok) {
      if (result.reason === "already_processed") {
        await markWebhookProcessed(inbox.id);
        if (retryJob) {
          await completeRetryJob(retryJob.id);
        }
        return NextResponse.json({ processed: true, replayed: true }, { status: 200 });
      }

      if (result.reason === "record_not_found") {
        await writeOfframpDeadLetter(
          body.transferId,
          rawPayload,
          "cashfree",
          "record_not_found_atomic",
        );
        await markWebhookFailed(inbox.id, "record_not_found_atomic", true);
        if (retryJob) {
          await db.retryJob.update({
            where: { id: retryJob.id },
            data: {
              status: "DEAD_LETTERED",
              lastError: "record_not_found_atomic",
              lastAttemptAt: new Date(),
            },
          });
        }
        return NextResponse.json({ processed: false, queued: "dlq" }, { status: 200 });
      }

      throw new Error(result.error ?? "Atomic Cashfree webhook processing failed.");
    }

    if (retryJob) {
      await completeRetryJob(retryJob.id);
    }
    return NextResponse.json({ processed: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Cashfree webhook processing failed.";
    const deadLetter = retryJob ? retryJob.attemptCount + 1 >= retryJob.maxAttempts : false;
    await markWebhookFailed(inbox.id, message, deadLetter);
    if (retryJob) {
      await db.retryJob.update({
        where: { id: retryJob.id },
        data: {
          status: deadLetter ? "DEAD_LETTERED" : "FAILED",
          lastError: message,
          lastAttemptAt: new Date(),
        },
      });
    }
    throw error;
  }
}
