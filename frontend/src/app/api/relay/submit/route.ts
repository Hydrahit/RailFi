import { NextRequest, NextResponse } from "next/server";
import { Connection, Transaction } from "@solana/web3.js";
import { getRelayRpcUrl, isRelayEnabled } from "@/lib/relayer/keypair";
import { validateRelayRequest } from "@/lib/relayer/policy";
import type { RelaySubmitResponse } from "@/lib/relayer/types";
import { enforceIpRateLimit, enforceWalletRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";
import { PROGRAM_ID, USDC_USD_PYTH_ACCOUNT } from "@/lib/solana";
import { buildTransferId, getOfframpRecord, hashUpiId, maskUpiId, putOfframpRecord } from "@/lib/offramp-store";
import {
  consumePreparedPayout,
  initiateUpiPayout,
} from "@/services/cashfree/payout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const MAX_SERIALIZED_TX_BASE64_LENGTH = 16_384;

interface RelaySubmitBody {
  serializedTransaction: string;
  lastValidBlockHeight: number;
}

function isExpiredRelayError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("blockhash not found") ||
    normalized.includes("block height exceeded") ||
    normalized.includes("last valid block height")
  );
}

function extractSimulationMessage(
  logs: string[] | undefined,
  simulationError: unknown,
): string {
  if (logs?.length) {
    const anchorMessage = logs.find((entry) => entry.includes("Error Message:"));
    if (anchorMessage) {
      return anchorMessage.split("Error Message:")[1]?.trim() || "Transaction simulation failed.";
    }

    const fallbackLog = [...logs]
      .reverse()
      .find((entry) => {
        const normalized = entry.trim();
        return (
          normalized.startsWith("Program log:") &&
          !normalized.includes("Instruction:") &&
          !normalized.includes("invoke [") &&
          !normalized.includes("success") &&
          !normalized.includes("consumed ")
        );
      });

    if (fallbackLog) {
      return fallbackLog.replace(/^Program log:\s*/, "").trim();
    }
  }

  if (typeof simulationError === "string" && simulationError.trim()) {
    return simulationError.trim();
  }

  if (simulationError && typeof simulationError === "object") {
    return JSON.stringify(simulationError);
  }

  return "Transaction simulation failed on Devnet. Please review the protocol state and retry.";
}

function parseRelaySubmitBody(value: unknown): RelaySubmitBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const serializedTransaction =
    typeof (value as { serializedTransaction?: unknown }).serializedTransaction === "string"
      ? (value as { serializedTransaction: string }).serializedTransaction.trim()
      : "";
  const lastValidBlockHeight = Number(
    (value as { lastValidBlockHeight?: unknown }).lastValidBlockHeight,
  );

  if (
    !serializedTransaction ||
    serializedTransaction.length > MAX_SERIALIZED_TX_BASE64_LENGTH ||
    !BASE64_RE.test(serializedTransaction) ||
    !Number.isInteger(lastValidBlockHeight) ||
    lastValidBlockHeight <= 0
  ) {
    return null;
  }

  return { serializedTransaction, lastValidBlockHeight };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  if (!isRelayEnabled()) {
    return NextResponse.json(
      { error: "Gasless relayer is not configured." },
      { status: 503 },
    );
  }

  const ipLimit = await enforceIpRateLimit(
    request,
    "relaySubmitIp",
    "Rate limit exceeded — relay submission capped at 30 requests per hour per IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  let body: RelaySubmitBody | null = null;
  try {
    body = parseRelaySubmitBody(await request.json());
  } catch {
    body = null;
  }

  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { serializedTransaction, lastValidBlockHeight } = body;

  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(serializedTransaction, "base64"));
  } catch {
    return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
  }

  const policy = await validateRelayRequest(transaction, true);
  if (!policy.allowed) {
    return NextResponse.json({ error: policy.reason }, { status: 403 });
  }

  const walletLimit = await enforceWalletRateLimit(
    policy.userPubkey!,
    "relaySubmitWallet",
    "Rate limit exceeded — 10 relays per hour per wallet.",
  );
  if (!walletLimit.allowed) {
    return NextResponse.json({ error: walletLimit.message }, { status: 429 });
  }

  try {
    const connection = new Connection(getRelayRpcUrl(), "confirmed");
    const railpayInstruction = transaction.instructions.find((instruction) =>
      instruction.programId.equals(PROGRAM_ID),
    );
    const submittedOracleAccount = railpayInstruction?.keys[5]?.pubkey?.toBase58() ?? null;
    console.info("[Relay] Submit oracle accounts:", {
      expectedOracleAccount: USDC_USD_PYTH_ACCOUNT.toBase58(),
      submittedOracleAccount,
    });

    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    if (currentBlockHeight > lastValidBlockHeight) {
      return NextResponse.json(
        { error: "Relay transaction expired before broadcast. Please try again." },
        { status: 409 },
      );
    }

    const simulation = await connection.simulateTransaction(transaction);

    if (simulation.value.err) {
      const logs = simulation.value.logs ?? [];
      const message = extractSimulationMessage(logs, simulation.value.err);
      console.error("[Relay] Simulation failed:", {
        error: simulation.value.err,
        logs,
      });
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: transaction.recentBlockhash!,
        lastValidBlockHeight,
      },
      "confirmed",
    );

    if (confirmation.value.err) {
      console.error("[Relay] Confirmation failed:", confirmation.value.err);
      return NextResponse.json(
        { error: "Relay transaction failed during confirmation." },
        { status: 409 },
      );
    }

    // SECURITY: consumePreparedPayout uses Redis getdel so a confirmed transaction cannot trigger two fiat payouts.
    const preparedPayout = await consumePreparedPayout(serializedTransaction);
    const derivedTransferId = buildTransferId(signature);
    let payoutTransferId: string | null = null;

    if (!preparedPayout && policy.actionKind === "trigger_offramp") {
      const existingRecord = await getOfframpRecord(derivedTransferId);
      if (existingRecord) {
        // SECURITY: If the staged payload was already consumed, return the existing payout instead of re-initiating Cashfree.
        const body: RelaySubmitResponse = {
          signature,
          blockhash: transaction.recentBlockhash!,
          lastValidBlockHeight,
          payoutTransferId: derivedTransferId,
          idempotent: true,
        };
        return NextResponse.json(body);
      }
      return NextResponse.json(
        { error: "Payout session expired or already processed. Submit a new transaction." },
        { status: 409 },
      );
    } else if (preparedPayout) {
      payoutTransferId = derivedTransferId;
      const existingRecord = await getOfframpRecord(derivedTransferId);
      if (existingRecord) {
        // SECURITY: Canonical record existence is the second idempotency guard before any Cashfree payout call.
        const body: RelaySubmitResponse = {
          signature,
          blockhash: transaction.recentBlockhash!,
          lastValidBlockHeight,
          payoutTransferId: derivedTransferId,
          idempotent: true,
        };
        return NextResponse.json(body);
      }

      await putOfframpRecord({
        transferId: payoutTransferId,
        solanaTx: signature,
        cashfreeId: payoutTransferId,
        walletAddress: preparedPayout.walletAddress,
        amountUsdc: Number(preparedPayout.amountMicroUsdc) / 1_000_000,
        amountMicroUsdc: preparedPayout.amountMicroUsdc,
        amountInr: Number(preparedPayout.inrPaise) / 100,
        amountInrPaise: Number(preparedPayout.inrPaise),
        upiMasked: maskUpiId(preparedPayout.upiId),
        // SECURITY: Canonical Redis record retains the original UPI for reconciliation-only fresh payout retries.
        upiId: preparedPayout.upiId,
        upiHash: hashUpiId(preparedPayout.upiId),
        status: "ON_CHAIN_CONFIRMED",
        utr: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        requiresReview: false,
        referralPubkey: preparedPayout.referralPubkey,
      });

      void initiateUpiPayout({
        transferId: payoutTransferId,
        walletAddress: preparedPayout.walletAddress,
        solanaSignature: signature,
        upiId: preparedPayout.upiId,
        amountMicroUsdc: preparedPayout.amountMicroUsdc,
        inrPaise: preparedPayout.inrPaise,
        referralPubkey: preparedPayout.referralPubkey,
      }).catch((error) => {
        console.error("[Cashfree] Failed to initiate UPI payout:", {
          payoutTransferId,
          signature,
          error,
        });
      });
    }

    const body: RelaySubmitResponse = {
      signature,
      blockhash: transaction.recentBlockhash!,
      lastValidBlockHeight,
      payoutTransferId,
    };

    return NextResponse.json(body);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transaction submission failed";
    const status = isExpiredRelayError(message) ? 409 : 502;
    const clientMessage = isExpiredRelayError(message)
      ? "Relay transaction expired before broadcast. Please try again."
      : "RailFi relay could not submit to Devnet. Please retry in a moment.";
    console.error("[Relay] Submit error:", error);
    return NextResponse.json(
      { error: clientMessage },
      { status },
    );
  }
}
