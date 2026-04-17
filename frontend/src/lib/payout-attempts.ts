import "server-only";

import { db } from "@/lib/db";

function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL?.trim();
}

export function buildExternalPayoutTransferId(transferId: string, retryCount = 0): string {
  return retryCount <= 0 ? transferId : `${transferId}-R${retryCount}`;
}

export async function createPayoutAttempt(args: {
  transferId: string;
  externalTransferId: string;
  kind: "cashfree-init" | "cashfree-retry" | "rpc-fallback";
  rpcUrl?: string | null;
}) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.payoutAttempt.upsert({
    where: { externalTransferId: args.externalTransferId },
    create: {
      transferId: args.transferId,
      externalTransferId: args.externalTransferId,
      kind: args.kind,
      rpcUrl: args.rpcUrl ?? null,
      status: "QUEUED",
    },
    update: {
      kind: args.kind,
      rpcUrl: args.rpcUrl ?? null,
    },
  });
}

export async function completePayoutAttempt(externalTransferId: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.payoutAttempt.update({
    where: { externalTransferId },
    data: {
      status: "SUCCESS",
      completedAt: new Date(),
      errorReason: null,
    },
  });
}

export async function failPayoutAttempt(externalTransferId: string, errorReason: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  return db.payoutAttempt.updateMany({
    where: { externalTransferId },
    data: {
      status: "FAILED",
      errorReason,
    },
  });
}
