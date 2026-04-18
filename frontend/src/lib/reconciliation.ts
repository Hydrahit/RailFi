import "server-only";

import { Connection } from "@solana/web3.js";
import { atomicReconcileAction } from "@/lib/atomic-operations";
import { db } from "@/lib/db";
import { getOfframpRecord } from "@/lib/offramp-store";
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
const SOLANA_TX_CHECK_TIMEOUT_MS = 8_000;

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
      if (!audit.solanaTx) {
        console.warn("[reconcile] RELAY_EXECUTING audit has no solanaTx; leaving for next pass.", {
          dodoPaymentId: audit.dodoPaymentId,
        });
        await db.dodoSettlementAudit.update({
          where: { id: audit.id },
          data: {
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
          },
        });
        continue;
      }

      const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
      if (!rpcUrl) {
        console.warn("[reconcile] SOLANA_RPC_URL is not configured; leaving RELAY_EXECUTING for next pass.", {
          dodoPaymentId: audit.dodoPaymentId,
          solanaTx: audit.solanaTx,
        });
        await db.dodoSettlementAudit.update({
          where: { id: audit.id },
          data: {
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
          },
        });
        continue;
      }

      const connection = new Connection(rpcUrl, "confirmed");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SOLANA_TX_CHECK_TIMEOUT_MS);

      try {
        const transaction = await Promise.race([
          connection.getTransaction(audit.solanaTx, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          }),
          new Promise<null>((_, reject) => {
            controller.signal.addEventListener(
              "abort",
              () => reject(new Error(`Timed out after ${SOLANA_TX_CHECK_TIMEOUT_MS}ms`)),
              { once: true },
            );
          }),
        ]);

        if (transaction && !transaction.meta?.err) {
          await db.dodoSettlementAudit.update({
            where: { id: audit.id },
            data: {
              status: "RELAY_CONFIRMED",
              failureReason: null,
            },
          });
          console.warn("[reconcile] Fixed lagging status for confirmed tx:", audit.solanaTx);
          continue;
        }

        const nextRetryCount = audit.retryCount + 1;
        if (nextRetryCount < 3) {
          console.warn("[reconcile] Solana transaction not found yet; leaving RELAY_EXECUTING for next pass.", {
            dodoPaymentId: audit.dodoPaymentId,
            solanaTx: audit.solanaTx,
            retryCount: nextRetryCount,
          });
          await db.dodoSettlementAudit.update({
            where: { id: audit.id },
            data: {
              retryCount: { increment: 1 },
              lastRetryAt: new Date(),
            },
          });
          continue;
        }
      } catch (error) {
        console.warn("[reconcile] Unable to verify RELAY_EXECUTING transaction; leaving for next pass.", {
          dodoPaymentId: audit.dodoPaymentId,
          solanaTx: audit.solanaTx,
          error: error instanceof Error ? error.message : error,
        });
        await db.dodoSettlementAudit.update({
          where: { id: audit.id },
          data: {
            retryCount: { increment: 1 },
            lastRetryAt: new Date(),
          },
        });
        continue;
      } finally {
        clearTimeout(timeout);
      }

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

      if (payoutRecord?.upiMasked) {
        console.warn("[reconcile] Skipping Cashfree retry because only masked UPI is stored.", {
          transferId: offramp.transferId,
          upiMasked: payoutRecord.upiMasked,
        });
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
        const result = await atomicReconcileAction({
          transferId: offramp.transferId,
          fromStatus: offramp.status,
          toStatus: "REQUIRES_REVIEW",
          reason: "primary_secondary_rpc_unconfirmed",
          evidence: {
            solanaTx: offramp.solanaTx,
            checkedAt: new Date().toISOString(),
          },
        });

        if (!result.ok) {
          console.warn(
            `[reconcile] Could not apply decision for ${offramp.transferId}:`,
            result.reason,
          );
        }
      }
    }
  }

  return summary;
}
