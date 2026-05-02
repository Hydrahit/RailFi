import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DodoIntentStatus } from "@/types/dodo";
import type { OfframpStatus } from "@/types/offramp";

export type PayoutStatus = OfframpStatus;
export type WebhookStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "PROCESSED"
  | "FAILED"
  | "DEAD_LETTERED";

type AuditStatus = PayoutStatus | DodoIntentStatus | "RELAY_CONFIRMED" | "PAYOUT_INITIATED";

const TERMINAL_PAYOUT_STATES = new Set<AuditStatus>([
  "SUCCESS",
  "FAILED",
  "REVERSED",
  "REQUIRES_REVIEW",
  "SETTLED",
]);

const VALID_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  STAGED: ["ON_CHAIN_CONFIRMED", "FAILED", "REQUIRES_REVIEW"],
  ON_CHAIN_CONFIRMED: ["PAYOUT_PENDING", "SUCCESS", "FAILED", "REQUIRES_REVIEW"],
  PAYOUT_PENDING: ["SUCCESS", "FAILED", "REVERSED", "REQUIRES_REVIEW"],
  SUCCESS: [],
  FAILED: ["PAYOUT_PENDING", "REQUIRES_REVIEW"],
  REVERSED: ["REQUIRES_REVIEW"],
  REQUIRES_REVIEW: ["PAYOUT_PENDING", "SUCCESS", "FAILED", "REVERSED"],
};

function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined) {
    return Prisma.JsonNull;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function truncatePayload(rawPayload: string): string {
  return rawPayload.length > 500 ? rawPayload.slice(0, 500) : rawPayload;
}

export async function isAlreadyProcessed(
  idempotencyKey: string,
): Promise<{ processed: boolean; cachedResult?: unknown }> {
  const existing = await db.idempotencyKey.findUnique({
    where: { key: idempotencyKey },
  });

  if (!existing) {
    return { processed: false };
  }

  if (existing.expiresAt < new Date()) {
    return { processed: false };
  }

  return { processed: true, cachedResult: existing.result ?? undefined };
}

async function markProcessed(
  idempotencyKey: string,
  result: unknown,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await tx.idempotencyKey.upsert({
    where: { key: idempotencyKey },
    create: {
      key: idempotencyKey,
      result: toJsonValue(result),
      expiresAt,
    },
    update: {
      result: toJsonValue(result),
      expiresAt,
    },
  });
}

export async function atomicProcessCashfreeWebhook(params: {
  webhookId: string;
  transferId: string;
  newStatus: PayoutStatus;
  utr?: string | null;
  requiresReview?: boolean;
  rawPayload: string;
}): Promise<
  | { ok: true }
  | { ok: false; reason: "already_processed" | "record_not_found" | "db_error"; error?: string }
> {
  const idempotencyKey = `webhook:cashfree:${params.transferId}:${params.newStatus}`;
  const { processed } = await isAlreadyProcessed(idempotencyKey);
  if (processed) {
    return { ok: false, reason: "already_processed" };
  }

  try {
    await db.$transaction(
      async (tx) => {
        await tx.webhookInbox.update({
          where: { id: params.webhookId },
          data: {
            status: "PROCESSED" as WebhookStatus,
            processedAt: new Date(),
            lastError: null,
          },
        });

        await tx.offrampTransaction.update({
          where: { cashfreeId: params.transferId },
          data: {
            status: params.newStatus,
            utr: params.utr ?? undefined,
            requiresReview: params.requiresReview ?? false,
            completedAt: TERMINAL_PAYOUT_STATES.has(params.newStatus) ? new Date() : undefined,
            failureReason:
              params.requiresReview ?? false
                ? `Cashfree webhook moved payout to ${params.newStatus}.`
                : null,
          },
        });

        await tx.auditLog.create({
          data: {
            eventType: "WEBHOOK_PROCESSED",
            entityId: params.transferId,
            entityType: "PAYOUT",
            toState: params.newStatus,
            metadata: toJsonValue({
              webhookId: params.webhookId,
              utr: params.utr ?? null,
              rawPayload: truncatePayload(params.rawPayload),
            }),
            performedBy: "system:cashfree-webhook",
          },
        });

        await markProcessed(
          idempotencyKey,
          { status: params.newStatus, utr: params.utr ?? null },
          tx,
        );
      },
      {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    return { ok: true };
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return { ok: false, reason: "record_not_found" };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("[atomic] atomicProcessCashfreeWebhook failed:", error);
    return { ok: false, reason: "db_error", error: message };
  }
}

export async function atomicProcessDodoWebhook(params: {
  webhookId: string;
  dodoPaymentId: string;
  newStatus: DodoIntentStatus;
  rawPayload: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: "already_processed" | "db_error"; error?: string }> {
  const idempotencyKey = `webhook:dodo:${params.dodoPaymentId}:${params.newStatus}`;
  const { processed } = await isAlreadyProcessed(idempotencyKey);
  if (processed) {
    return { ok: false, reason: "already_processed" };
  }

  try {
    await db.$transaction(
      async (tx) => {
        await tx.webhookInbox.update({
          where: { id: params.webhookId },
          data: {
            status: "PROCESSED" as WebhookStatus,
            processedAt: new Date(),
            lastError: null,
          },
        });

        await tx.dodoSettlementAudit.updateMany({
          where: { dodoPaymentId: params.dodoPaymentId },
          data: {
            status: params.newStatus,
            failureReason: null,
          },
        });

        await tx.auditLog.create({
          data: {
            eventType: "WEBHOOK_PROCESSED",
            entityId: params.dodoPaymentId,
            entityType: "PAYOUT",
            toState: params.newStatus,
            metadata: toJsonValue({
              webhookId: params.webhookId,
              rawPayload: truncatePayload(params.rawPayload),
              ...(params.metadata ?? {}),
            }),
            performedBy: "system:dodo-webhook",
          },
        });

        await markProcessed(idempotencyKey, { status: params.newStatus }, tx);
      },
      {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[atomic] atomicProcessDodoWebhook failed:", error);
    return { ok: false, reason: "db_error", error: message };
  }
}

export async function atomicPayoutStateTransition(params: {
  transferId: string;
  fromStatus: PayoutStatus;
  toStatus: PayoutStatus;
  metadata?: Record<string, unknown>;
  performedBy?: string;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_transition" | "record_not_found" | "state_mismatch" | "db_error";
      error?: string;
    }
> {
  const allowed = VALID_TRANSITIONS[params.fromStatus];
  if (!allowed.includes(params.toStatus)) {
    return {
      ok: false,
      reason: "invalid_transition",
      error: `Cannot transition from ${params.fromStatus} to ${params.toStatus}`,
    };
  }

  try {
    await db.$transaction(
      async (tx) => {
        const record = await tx.offrampTransaction.findUnique({
          where: { transferId: params.transferId },
          select: { id: true, status: true },
        });

        if (!record) {
          throw new Error("RECORD_NOT_FOUND");
        }

        if (record.status !== params.fromStatus) {
          throw new Error(
            `STATE_MISMATCH: expected ${params.fromStatus}, found ${record.status}`,
          );
        }

        await tx.offrampTransaction.update({
          where: { transferId: params.transferId },
          data: {
            status: params.toStatus,
            completedAt: TERMINAL_PAYOUT_STATES.has(params.toStatus) ? new Date() : undefined,
            requiresReview: params.toStatus === "REQUIRES_REVIEW",
            failureReason:
              params.toStatus === "FAILED" || params.toStatus === "REQUIRES_REVIEW"
                ? (params.metadata?.reason as string | undefined) ?? null
                : null,
          },
        });

        await tx.auditLog.create({
          data: {
            eventType: "PAYOUT_STATE_CHANGE",
            entityId: params.transferId,
            entityType: "PAYOUT",
            fromState: params.fromStatus,
            toState: params.toStatus,
            metadata: toJsonValue(params.metadata),
            performedBy: params.performedBy ?? "system",
          },
        });
      },
      {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "RECORD_NOT_FOUND") {
      return { ok: false, reason: "record_not_found" };
    }
    if (message.startsWith("STATE_MISMATCH")) {
      return { ok: false, reason: "state_mismatch", error: message };
    }
    console.error("[atomic] atomicPayoutStateTransition failed:", error);
    return { ok: false, reason: "db_error", error: message };
  }
}

export async function atomicLinkWallet(params: {
  userId: string;
  walletAddress: string;
  performedBy: string;
}): Promise<{ ok: true } | { ok: false; reason: "wallet_taken" | "db_error"; error?: string }> {
  const idempotencyKey = `wallet-link:${params.userId}:${params.walletAddress}`;
  const { processed } = await isAlreadyProcessed(idempotencyKey);
  if (processed) {
    return { ok: true };
  }

  try {
    await db.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { walletAddress: params.walletAddress },
          select: { id: true, email: true, googleLinked: true },
        });

        if (existing && existing.id !== params.userId) {
          if (existing.email || existing.googleLinked) {
            throw new Error("WALLET_TAKEN");
          }

          await tx.user.update({
            where: { id: existing.id },
            data: {
              walletAddress: null,
              walletLinked: false,
            },
          });
        }

        await tx.user.update({
          where: { id: params.userId },
          data: {
            walletAddress: params.walletAddress,
            walletLinked: true,
            googleLinked: true,
          },
        });

        await tx.auditLog.create({
          data: {
            eventType: "WALLET_LINKED",
            entityId: params.userId,
            entityType: "USER",
            toState: "LINKED",
            metadata: toJsonValue({ walletAddress: params.walletAddress }),
            performedBy: params.performedBy,
          },
        });

        await markProcessed(idempotencyKey, { linked: true }, tx);
      },
      {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return { ok: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "WALLET_TAKEN") {
      return {
        ok: false,
        reason: "wallet_taken",
        error: "Wallet already linked to another account",
      };
    }
    console.error("[atomic] atomicLinkWallet failed:", error);
    return { ok: false, reason: "db_error", error: message };
  }
}

export async function atomicReconcileAction(params: {
  transferId: string;
  fromStatus: PayoutStatus;
  toStatus: PayoutStatus;
  reason: string;
  evidence?: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: string; error?: string }> {
  const idempotencyKey = `reconcile:${params.transferId}:${params.fromStatus}:${params.toStatus}`;
  const { processed } = await isAlreadyProcessed(idempotencyKey);
  if (processed) {
    return { ok: false, reason: "already_processed" };
  }

  const result = await atomicPayoutStateTransition({
    transferId: params.transferId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    metadata: {
      reason: params.reason,
      evidence: params.evidence,
      source: "reconciliation",
    },
    performedBy: "system:reconciliation",
  });

  if (!result.ok) {
    return result;
  }

  await db.idempotencyKey
    .create({
      data: {
        key: idempotencyKey,
        result: toJsonValue({ decided: params.toStatus }),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    .catch(() => {});

  return { ok: true };
}
