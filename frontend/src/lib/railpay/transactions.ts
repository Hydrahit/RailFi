"use client";

import { Buffer } from "buffer";
import type {
  Connection,
  PublicKey,
  SendOptions as SendTransactionOptions,
  VersionedTransaction,
} from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { TransactionConfirmationTimeoutError, RelayRequestError, parseRelayError, shouldFallbackFromRelay } from "@/lib/railpay/errors";
import type {
  RelayAction,
  RelayPrepareResponse,
  RelaySubmitResponse,
} from "@/lib/relayer/types";

export interface SubmittedTransaction {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export async function submitTransactionDirect(params: {
  connection: Connection;
  publicKey: PublicKey | null;
  sendTransaction?: ((
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ) => Promise<string>) | undefined;
  transaction: Transaction;
}): Promise<SubmittedTransaction> {
  const { connection, publicKey, sendTransaction, transaction } = params;
  if (!publicKey || !sendTransaction) {
    throw new Error("Wallet not connected.");
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const signature = await sendTransaction(transaction, connection, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  return {
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };
}

export async function confirmSubmittedTransaction(params: {
  connection: Connection;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  timeoutMs: number;
}): Promise<void> {
  const { connection, signature, blockhash, lastValidBlockHeight, timeoutMs } = params;
  let timeoutId: number | null = null;
  try {
    const confirmation = await Promise.race([
      connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed",
      ),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new TransactionConfirmationTimeoutError(signature, timeoutMs));
        }, timeoutMs);
      }),
    ]);

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed during confirmation: ${JSON.stringify(confirmation.value.err)}`,
      );
    }
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

export async function submitTransactionViaRelay(params: {
  signTransaction?: ((transaction: Transaction) => Promise<Transaction>) | undefined;
  action: RelayAction;
}): Promise<SubmittedTransaction> {
  const { signTransaction, action } = params;
  if (!signTransaction) {
    throw new Error("Wallet does not support transaction signing.");
  }

  const prepareResponse = await fetch("/api/relay/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });

  if (!prepareResponse.ok) {
    throw new RelayRequestError(
      await parseRelayError(prepareResponse),
      prepareResponse.status,
    );
  }

  const prepared = (await prepareResponse.json()) as RelayPrepareResponse;
  const preparedTransaction = Transaction.from(
    Buffer.from(prepared.serializedTransaction, "base64"),
  );
  const signedTransaction = await signTransaction(preparedTransaction);

  const submitResponse = await fetch("/api/relay/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serializedTransaction: Buffer.from(signedTransaction.serialize()).toString("base64"),
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    }),
  });

  if (!submitResponse.ok) {
    throw new RelayRequestError(
      await parseRelayError(submitResponse),
      submitResponse.status,
    );
  }

  return (await submitResponse.json()) as RelaySubmitResponse;
}

export async function submitWithPreferredPath(params: {
  signTransaction?: ((transaction: Transaction) => Promise<Transaction>) | undefined;
  submitDirect: () => Promise<SubmittedTransaction>;
  action: RelayAction;
}): Promise<SubmittedTransaction> {
  const { signTransaction, submitDirect, action } = params;
  if (signTransaction) {
    try {
      return await submitTransactionViaRelay({ signTransaction, action });
    } catch (error) {
      if (!shouldFallbackFromRelay(error)) {
        throw error;
      }
      console.warn("[Relay] Falling back to direct wallet submission:", error);
    }
  }

  return submitDirect();
}
