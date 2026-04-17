import "server-only";

import {
  getOfframpRecord,
  mapCashfreeStatusToOfframpStatus,
  updateOfframpRecord,
  writeOfframpDeadLetter,
} from "@/lib/offramp-store";
import { updatePayoutRecordFromWebhook } from "@/services/cashfree/payout";

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

export function extractCashfreeTransferId(payload: Record<string, unknown>): string | null {
  return (
    readNestedString(payload, ["data", "transferId"]) ??
    readNestedString(payload, ["data", "referenceId"]) ??
    readNestedString(payload, ["transferId"]) ??
    readNestedString(payload, ["referenceId"])
  );
}

export function extractCashfreeStatus(payload: Record<string, unknown>): string | null {
  return (
    readNestedString(payload, ["data", "status"]) ??
    readNestedString(payload, ["data", "transferStatus"]) ??
    readNestedString(payload, ["status"]) ??
    readNestedString(payload, ["transferStatus"])
  );
}

export function extractCashfreeEventType(payload: Record<string, unknown>): string | null {
  return (
    readNestedString(payload, ["event"]) ??
    readNestedString(payload, ["type"]) ??
    readNestedString(payload, ["data", "event"])
  );
}

export function extractCashfreeUtr(payload: Record<string, unknown>): string | null {
  return readNestedString(payload, ["data", "utr"]) ?? readNestedString(payload, ["utr"]);
}

export async function processCashfreeWebhookPayload(
  payload: Record<string, unknown>,
  rawBody: string,
): Promise<{ transferId: string | null; eventType: string }> {
  const eventType = extractCashfreeEventType(payload) ?? "UNKNOWN_EVENT";
  const transferId = extractCashfreeTransferId(payload);
  const status = extractCashfreeStatus(payload);
  const utr = extractCashfreeUtr(payload);

  if (!transferId) {
    return { transferId: null, eventType };
  }

  const current = await getOfframpRecord(transferId);
  if (!current) {
    await writeOfframpDeadLetter(transferId, rawBody, "cashfree", "Orphaned Cashfree webhook.");
    return { transferId, eventType };
  }

  await updatePayoutRecordFromWebhook({
    transferId,
    status,
    utr,
  });

  const mappedStatus = mapCashfreeStatusToOfframpStatus(status);
  await updateOfframpRecord(transferId, () => ({
    ...current,
    status:
      mappedStatus === "FAILED" || mappedStatus === "REVERSED"
        ? "REQUIRES_REVIEW"
        : mappedStatus,
    utr: utr ?? current.utr,
    completedAt:
      mappedStatus === "SUCCESS" || mappedStatus === "FAILED" || mappedStatus === "REVERSED"
        ? new Date().toISOString()
        : current.completedAt,
    requiresReview: mappedStatus === "FAILED" || mappedStatus === "REVERSED",
    failureReason:
      mappedStatus === "FAILED" || mappedStatus === "REVERSED"
        ? `Cashfree webhook reported ${status ?? "UNKNOWN"}.`
        : current.failureReason ?? null,
  }));

  return { transferId, eventType };
}
