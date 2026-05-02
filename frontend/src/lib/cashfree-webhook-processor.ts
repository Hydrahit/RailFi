import "server-only";

import { processCashfreeWebhookPayload as processExistingCashfreeWebhookPayload } from "@/lib/cashfree-webhooks";

// SECURITY: Shared webhook processor keeps live and replayed Cashfree events on one payout-state code path.
export async function processCashfreeWebhookPayload(payload: unknown, rawBody?: string): Promise<void> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cashfree webhook payload must be an object.");
  }

  await processExistingCashfreeWebhookPayload(
    payload as Record<string, unknown>,
    rawBody ?? JSON.stringify(payload),
  );
}
