"use client";
import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { useConnection } from "@solana/wallet-adapter-react";
import type { ParsedTransactionWithMeta, PublicKey } from "@solana/web3.js";
import rawIdl from "../idl/railpay.json";
import { PROGRAM_ID, USDC_DECIMALS, explorerTx } from "@/lib/solana";
import type { Transaction } from "@/types/railpay";

const idl = rawIdl as Idl;
const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
globalWithBuffer.Buffer ??= Buffer;

interface OfframpRequestedEvent {
  user: PublicKey;
  vault: PublicKey;
  usdcAmount: bigint | number;
  inrPaise: bigint | number;
  receiptId: number;
  destinationUpiHash: number[];
  timestamp: bigint | number;
}

interface HistoryState {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function toNumber(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.toLowerCase().includes("too many requests");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function getParsedTransactionsSequentially(
  connection: ReturnType<typeof useConnection>["connection"],
  signatures: string[],
): Promise<(ParsedTransactionWithMeta | null)[]> {
  const parsedTransactions: (ParsedTransactionWithMeta | null)[] = [];

  for (const signature of signatures) {
    try {
      const parsedTransaction = await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      parsedTransactions.push(parsedTransaction);
      await delay(200);
    } catch (error: unknown) {
      if (isRateLimitError(error)) {
        throw error;
      }

      parsedTransactions.push(null);
    }
  }

  return parsedTransactions;
}

function parseOfframpEvent(
  tx: ParsedTransactionWithMeta,
  signature: string,
  parser: EventParser,
): Transaction | null {
  if (!tx.meta?.logMessages?.length) {
    return null;
  }

  const events = Array.from(parser.parseLogs(tx.meta.logMessages));
  const offrampEvent = events.find((event) => event.name === "OfframpRequested");

  if (!offrampEvent) {
    return null;
  }

  const offrampData = offrampEvent.data as unknown as OfframpRequestedEvent;

  const usdcAmount = toNumber(offrampData.usdcAmount) / 10 ** USDC_DECIMALS;
  const inrPaise = toNumber(offrampData.inrPaise);
  const timestampMs = tx.blockTime ? tx.blockTime * 1000 : Date.now();
  const err = tx.meta.err;

  return {
    id: signature,
    type: "offramp",
    amount: usdcAmount,
    inrAmount: inrPaise > 0 ? inrPaise : undefined,
    timestamp: timestampMs,
    status: err ? "failed" : "confirmed",
    explorerUrl: explorerTx(signature),
    receiptId: offrampData.receiptId,
  };
}

export function useHistory(vaultPda: PublicKey | null): HistoryState {
  const { connection } = useConnection();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRefreshingRef = useRef(false);

  const parser = useMemo(() => new EventParser(PROGRAM_ID, new BorshCoder(idl)), []);

  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) {
      return;
    }

    if (!vaultPda) {
      setTransactions([]);
      setError(null);
      return;
    }

    isRefreshingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const signatures = await connection.getSignaturesForAddress(vaultPda, {
        limit: 5,
      });

      if (signatures.length === 0) {
        setTransactions([]);
        return;
      }

      const parsedTransactions = await getParsedTransactionsSequentially(
        connection,
        signatures.map(({ signature }) => signature),
      );

      const nextTransactions = parsedTransactions
        .map((tx, index) => {
          if (!tx) {
            return null;
          }

          return parseOfframpEvent(tx, signatures[index].signature, parser);
        })
        .filter((tx): tx is Transaction => tx !== null)
        .sort((a, b) => b.timestamp - a.timestamp);

      setTransactions(nextTransactions);
    } catch (historyError: unknown) {
      const errorMessage =
        historyError instanceof Error
          ? historyError.message
          : "Failed to fetch on-chain history.";
      setError(
        errorMessage.includes("429")
          ? "RPC rate limit reached. Wait a moment, then tap Refresh."
          : errorMessage,
      );
    } finally {
      isRefreshingRef.current = false;
      setIsLoading(false);
    }
  }, [connection, parser, vaultPda]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    transactions,
    isLoading,
    error,
    refresh,
  };
}

