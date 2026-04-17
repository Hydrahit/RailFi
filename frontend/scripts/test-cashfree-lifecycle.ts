import dotenv from "dotenv";

import crypto from "crypto";
import { NextRequest } from "next/server";
import { POST as cashfreeWebhook } from "@/app/api/webhooks/cashfree/route";
import {
  getOfframpDeadLetter,
  getOfframpRecord,
  putOfframpRecord,
} from "@/lib/offramp-store";

dotenv.config({ path: ".env.local" });
dotenv.config();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sign(rawBody: string): string {
  const secret = process.env.CASHFREE_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new Error("CASHFREE_CLIENT_SECRET is required for webhook lifecycle testing.");
  }
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function main() {
  const seedTransferId = `TEST_${Date.now()}`;
  await putOfframpRecord({
    transferId: seedTransferId,
    solanaTx: "seed-signature",
    cashfreeId: seedTransferId,
    walletAddress: "seed-wallet",
    amountUsdc: 10,
    amountMicroUsdc: "10000000",
    amountInr: 833.5,
    amountInrPaise: 83350,
    upiMasked: "ax***@okicici",
    upiHash: null,
    status: "PAYOUT_PENDING",
    utr: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    requiresReview: false,
    referralPubkey: null,
  });

  const validPayload = JSON.stringify({
    event: "TRANSFER_SUCCESS",
    data: {
      transferId: seedTransferId,
      status: "SUCCESS",
      utr: "UTR123456",
    },
  });

  const validResponse = await cashfreeWebhook(
    new NextRequest("http://localhost/api/webhooks/cashfree", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": sign(validPayload),
      },
      body: validPayload,
    }),
  );
  assert(validResponse.status === 200, "Valid webhook should return 200.");
  const updated = await getOfframpRecord(seedTransferId);
  assert(updated?.status === "SUCCESS", "Valid webhook should update offramp status to SUCCESS.");
  assert(updated?.utr === "UTR123456", "Valid webhook should persist UTR.");

  const invalidPayload = JSON.stringify({
    data: { transferId: seedTransferId, status: "FAILED" },
  });
  const invalidResponse = await cashfreeWebhook(
    new NextRequest("http://localhost/api/webhooks/cashfree", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": "invalid-signature",
      },
      body: invalidPayload,
    }),
  );
  assert(invalidResponse.status === 401, "Invalid signature should return 401.");

  const unknownTransferId = `UNKNOWN_${Date.now()}`;
  const orphanPayload = JSON.stringify({
    data: {
      transferId: unknownTransferId,
      status: "SUCCESS",
      utr: "UTR999",
    },
  });
  const orphanResponse = await cashfreeWebhook(
    new NextRequest("http://localhost/api/webhooks/cashfree", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": sign(orphanPayload),
      },
      body: orphanPayload,
    }),
  );
  assert(orphanResponse.status === 200, "Orphan webhook should still return 200.");
  const dlq = await getOfframpDeadLetter(unknownTransferId);
  assert(!!dlq, "Orphan webhook should be written to the DLQ.");

  console.log("Cashfree lifecycle test passed.");
}

void main().catch((error: unknown) => {
  console.error("Cashfree lifecycle test failed:", error);
  process.exit(1);
});
