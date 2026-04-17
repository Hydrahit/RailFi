import "server-only";

import { Connection } from "@solana/web3.js";
import { db } from "@/lib/db";
import { getOfframpRecord, updateOfframpRecord } from "@/lib/offramp-store";
import {
  buildExternalPayoutTransferId,
  createPayoutAttempt,
} from "@/lib/payout-attempts";
import {
  getPayoutStatus,
  getStoredPayoutRecord,
  initiateUpiPayout,
} from "@/services/cashfree/payout";
import { getPrimarySolanaRpcUrl, getSecondarySolanaRpcUrl } from "@/lib/server-env";

const STALE_RELAY_MS = 5 * 60 * 1000;
const STALE_PAYOUT_MS = 5 * 60 * 1000;

export interface ReconciliationSummary {
  checkedDodo: number;
  checkedOfframps: number;
  retriedPayouts: number;
  fallbackRpcChecks: number;
}

export async function runReconciliation(): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    checkedDodo: 0,
    checkedOfframps: 0,
    retriedPayouts: 0,
    fallbackRpcChecks: 0,
  };

  const [staleDodo, staleOfframps] = await Promise.all([
    db.dodoSettlementAudit.findMany({
      where: {
        status: { in: ["RELAY_EXECUTING", "RELAY_SUBMITTED"] },
      },
      take: 50,
      orderBy: { updatedAt: "asc" },
    }),
    db.offrampTransaction.findMany({
      where: {
        status: { in: ["ON_CHAIN_CONFIRMED", "PAYOUT_PENDING", "FAILED", "REQUIRES_REVIEW"] },
      },
      take: 50,
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  for (const audit of staleDodo) {
    summary.checkedDodo += 1;
    const staleBy =
      Date.now() -
      (audit.executionStartedAt?.getTime() ??
        audit.executedAt?.getTime() ??
        audit.updatedAt.getTime());

    if (audit.status === "RELAY_SUBMITTED" && audit.transferId) {
      const canonical = await getOfframpRecord(audit.transferId);
      if (canonical?.utr || canonical?.status === "SUCCESS") {
        await db.dodoSettlementAudit.update({
          where: { id: audit.id },
          data: {
            status: "SETTLED",
            failureReason: null,
          },
        });
      }
      continue;
    }

    if (audit.status === "RELAY_EXECUTING" && staleBy > STALE_RELAY_MS) {
      await db.dodoSettlementAudit.update({
        where: { id: audit.id },
        data: {
          status: "FAILED",
          failureReason:
            audit.failureReason ??
            "Execution remained in RELAY_EXECUTING beyond SLA and requires operator review.",
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
        },
      });
    }
  }

  for (const offramp of staleOfframps) {
    summary.checkedOfframps += 1;
    const ageMs = Date.now() - offramp.updatedAt.getTime();

    if ((offramp.status === "ON_CHAIN_CONFIRMED" || offramp.status === "PAYOUT_PENDING") && ageMs > STALE_PAYOUT_MS) {
      await getPayoutStatus(offramp.transferId);
    }

    if ((offramp.status === "FAILED" || offramp.status === "REQUIRES_REVIEW") && !offramp.utr && ageMs > STALE_PAYOUT_MS) {
      const payoutRecord = await getStoredPayoutRecord(offramp.transferId);

      if (payoutRecord?.upiId) {
        const retryCount = offramp.retryCount + 1;
        const externalTransferId = buildExternalPayoutTransferId(offramp.transferId, retryCount);
        await createPayoutAttempt({
          transferId: offramp.transferId,
          externalTransferId,
          kind: "cashfree-retry",
        });
        await initiateUpiPayout({
          transferId: offramp.transferId,
          walletAddress: offramp.walletAddress,
          solanaSignature: offramp.solanaTx,
          upiId: payoutRecord.upiId,
          amountMicroUsdc: offramp.amountMicroUsdc,
          inrPaise: String(offramp.amountInrPaise),
          referralPubkey: offramp.referralPubkey,
          externalTransferId,
          attemptKind: "cashfree-retry",
        });
        summary.retriedPayouts += 1;
        continue;
      }
    }

    if (offramp.status === "ON_CHAIN_CONFIRMED" && !offramp.completedAt) {
      const secondaryRpcUrl = getSecondarySolanaRpcUrl();
      if (!secondaryRpcUrl) {
        continue;
      }

      const [primaryConnection, secondaryConnection] = [
        new Connection(getPrimarySolanaRpcUrl(), "confirmed"),
        new Connection(secondaryRpcUrl, "confirmed"),
      ];

      const [primaryStatus, secondaryStatus] = await Promise.allSettled([
        primaryConnection.getSignatureStatus(offramp.solanaTx, { searchTransactionHistory: true }),
        secondaryConnection.getSignatureStatus(offramp.solanaTx, { searchTransactionHistory: true }),
      ]);

      summary.fallbackRpcChecks += 1;

      const hasConfirmed =
        (primaryStatus.status === "fulfilled" && primaryStatus.value.value?.confirmationStatus) ||
        (secondaryStatus.status === "fulfilled" && secondaryStatus.value.value?.confirmationStatus);

      if (!hasConfirmed) {
        await updateOfframpRecord(offramp.transferId, (current) =>
          current
            ? {
                ...current,
                status: "REQUIRES_REVIEW",
                requiresReview: true,
                failureReason: "Primary and secondary RPC could not confirm the on-chain signature.",
                retryCount: (current.retryCount ?? 0) + 1,
                lastRetryAt: new Date().toISOString(),
              }
            : null,
        );
      }
    }
  }

  return summary;
}
