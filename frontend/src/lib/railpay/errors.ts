"use client";

import type { AnchorProvider } from "@coral-xyz/anchor";
import { SendTransactionError } from "@solana/web3.js";

export class RelayRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RelayRequestError";
  }
}

export class TransactionConfirmationTimeoutError extends Error {
  constructor(
    readonly signature: string,
    readonly timeoutMs: number,
  ) {
    super(
      "Transaction confirmation is taking longer than expected. Check Explorer before retrying.",
    );
    this.name = "TransactionConfirmationTimeoutError";
  }
}

export function isUserRejection(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("user rejected") ||
      message.includes("wallet disconnected") ||
      message.includes("rejected the request")
    );
  }
  return false;
}

export function formatProgramError(error: unknown, fallback: string): string {
  if (isUserRejection(error)) {
    return "Cancelled.";
  }

  if (error instanceof TransactionConfirmationTimeoutError) {
    return error.message;
  }

  if (error instanceof RelayRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    const lowerMessage = error.message.toLowerCase();
    if (
      lowerMessage.includes("block height exceeded") ||
      lowerMessage.includes("blockhash not found") ||
      lowerMessage.includes("signature has expired")
    ) {
      return "Transaction expired before confirmation. Please retry.";
    }

    return error.message;
  }

  return fallback;
}

export async function logSendTransactionError(
  connection: AnchorProvider["connection"],
  error: unknown,
): Promise<void> {
  if (error instanceof SendTransactionError) {
    try {
      const logs = await error.getLogs(connection);
      console.error("SendTransactionError logs:", logs ?? []);
      return;
    } catch {
      console.error("SendTransactionError logs:", error.logs ?? []);
      return;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "logs" in error &&
    Array.isArray((error as { logs?: unknown }).logs)
  ) {
    console.error("Transaction logs:", (error as { logs: unknown[] }).logs);
  }
}

export async function parseRelayError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) {
      return body.error;
    }
  } catch (parseErr) {
    console.error("[relay] Failed to parse error body:", parseErr);
    return "Transaction failed - see console for details";
  }

  return `Relay request failed (${response.status})`;
}

export function shouldFallbackFromRelay(error: unknown): boolean {
  if (error instanceof RelayRequestError) {
    return error.status === 404 || error.status === 503;
  }

  return error instanceof TypeError;
}
