import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { DodoOfframpIntent } from "@/types/dodo";

function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

export async function mirrorDodoSettlementAudit(
  intent: DodoOfframpIntent,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  if (
    !intent.walletAddress ||
    typeof intent.usdcAmount !== "number" ||
    typeof intent.inrQuote !== "number"
  ) {
    throw new Error("Cannot mirror Dodo settlement audit without claimed execution context.");
  }

  const auditPayload = {
    dodoPaymentId: intent.dodoPaymentId,
    transferId: intent.transferId ?? null,
    solanaTx: intent.solanaTx ?? null,
    walletAddress: intent.walletAddress,
    customerEmail: intent.customerEmail,
    customerName: intent.customerName,
    currency: intent.currency,
    amountUsd: new Prisma.Decimal(intent.amountUsd),
    amountMicroUsdc: String(intent.usdcAmount),
    inrQuotePaise: intent.inrQuote,
    status: intent.status,
    failureReason: intent.failureReason ?? intent.lastExecutionError ?? null,
    retryCount: intent.retryCount ?? 0,
    lastRetryAt:
      typeof intent.lastRetryAt === "number"
        ? new Date(intent.lastRetryAt)
        : null,
    executionLockToken: intent.executionLockToken ?? null,
    executionStartedAt:
      typeof intent.executionStartedAt === "number"
        ? new Date(intent.executionStartedAt)
        : null,
    executedAt:
      typeof intent.executedAt === "number"
        ? new Date(intent.executedAt)
        : null,
  };

  try {
    await db.dodoSettlementAudit.upsert({
      where: { dodoPaymentId: intent.dodoPaymentId },
      create: auditPayload,
      update: auditPayload,
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.dodoSettlementAudit.findFirst({
        where: {
          OR: [
            { dodoPaymentId: intent.dodoPaymentId },
            { transferId: intent.transferId },
            { solanaTx: intent.solanaTx },
          ],
        },
      });

      if (
        existing &&
        existing.dodoPaymentId === intent.dodoPaymentId &&
        existing.transferId === intent.transferId &&
        existing.solanaTx === intent.solanaTx
      ) {
        return;
      }

      throw new Error(
        "Dodo settlement audit conflict detected for an existing payment or transfer.",
      );
    }

    throw error;
  }
}
