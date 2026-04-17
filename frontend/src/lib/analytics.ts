import "server-only";

import { cache } from "react";
import { PROGRAM_ID, CONFIGURED_USDC_MINT } from "@/lib/solana";
import { getServerHeliusApiKey } from "@/lib/server-env";

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const WARN_AT_MAX_PAGES = true;
const ONE_DAY_SECONDS = 86_400;
const THIRTY_DAYS_SECONDS = ONE_DAY_SECONDS * 30;
const SEVEN_DAYS_SECONDS = ONE_DAY_SECONDS * 7;

interface HeliusEnhancedInstruction {
  programId?: string;
  accounts?: string[];
}

interface HeliusEnhancedTransaction {
  signature: string;
  timestamp: number;
  transactionError?: unknown;
  instructions?: HeliusEnhancedInstruction[];
  accountData?: Array<{ account: string }>;
  tokenTransfers?: Array<{
    mint?: string;
    tokenAmount?: number;
    fromUserAccount?: string;
    toUserAccount?: string;
  }>;
  description?: string;
}

export interface AnalyticsRecentTransaction {
  signature: string;
  timestamp: number;
  wallet: string;
  usdcAmount: number;
  description: string;
}

export interface AnalyticsSnapshot {
  totalVolumeUsdc: number;
  totalTransactions: number;
  totalUniqueWallets: number;
  last7dTransactions: number;
  last30dTransactions: number;
  recentTransactions: AnalyticsRecentTransaction[];
  programId: string;
  generatedAt: string;
  dataSource: string;
  dataTruncated: boolean;
  dataNote: string;
  degraded: boolean;
  error?: string;
}

interface FetchedProgramTransactions {
  transactions: HeliusEnhancedTransaction[];
  pagesFetched: number;
  dataTruncated: boolean;
}

function getHeliusApiKey(): string {
  return getServerHeliusApiKey();
}

async function fetchProgramTransactionsPage(before?: string): Promise<HeliusEnhancedTransaction[]> {
  const apiKey = getHeliusApiKey();
  const url = new URL(`https://api.helius.xyz/v0/addresses/${PROGRAM_ID.toBase58()}/transactions`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("type", "ANY");
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (before) {
    url.searchParams.set("before", before);
  }

  const response = await fetch(url.toString(), {
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Helius analytics request failed with status ${response.status}.`);
  }

  return (await response.json()) as HeliusEnhancedTransaction[];
}

async function fetchAllProgramTransactions(): Promise<FetchedProgramTransactions> {
  const allTransactions: HeliusEnhancedTransaction[] = [];
  let before: string | undefined;
  let pagesFetched = 0;
  let dataTruncated = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await fetchProgramTransactionsPage(before);
    if (batch.length === 0) {
      break;
    }

    pagesFetched += 1;
    allTransactions.push(...batch);
    before = batch[batch.length - 1]?.signature;

    if (batch.length < PAGE_SIZE) {
      break;
    }

    if (page === MAX_PAGES - 1) {
      dataTruncated = true;
    }
  }

  if (dataTruncated && WARN_AT_MAX_PAGES) {
    console.warn(
      `[analytics] Reached MAX_PAGES (${MAX_PAGES}) - historical data may be truncated. Consider a dedicated indexer for long-term stats.`,
    );
  }

  return {
    transactions: allTransactions,
    pagesFetched,
    dataTruncated,
  };
}

function extractProgramWallet(transaction: HeliusEnhancedTransaction): string {
  const programInstruction = transaction.instructions?.find(
    (instruction) => instruction.programId === PROGRAM_ID.toBase58(),
  );
  const instructionWallet = programInstruction?.accounts?.find(
    (account) => account && account !== PROGRAM_ID.toBase58(),
  );

  if (instructionWallet) {
    return instructionWallet;
  }

  const accountDataWallet = transaction.accountData?.find(
    (item) => item.account && item.account !== PROGRAM_ID.toBase58(),
  )?.account;

  return accountDataWallet ?? "Unknown";
}

function extractUsdcVolume(transaction: HeliusEnhancedTransaction): number {
  const usdcMint = CONFIGURED_USDC_MINT.toBase58();
  return (transaction.tokenTransfers ?? [])
    .filter((transfer) => transfer.mint === usdcMint)
    .reduce((sum, transfer) => sum + (transfer.tokenAmount ?? 0), 0);
}

function isProgramTransaction(transaction: HeliusEnhancedTransaction): boolean {
  return (
    transaction.transactionError == null &&
    (transaction.instructions?.some(
      (instruction) => instruction.programId === PROGRAM_ID.toBase58(),
    ) ??
      transaction.accountData?.some((item) => item.account === PROGRAM_ID.toBase58()) ??
      false)
  );
}

export const getAnalyticsSnapshot = cache(async (): Promise<AnalyticsSnapshot> => {
  const now = Math.floor(Date.now() / 1000);

  try {
    const fetchedTransactions = await fetchAllProgramTransactions();
    const transactions = fetchedTransactions.transactions.filter(isProgramTransaction);
    const uniqueWallets = new Set<string>();
    let totalVolumeUsdc = 0;
    let last7dTransactions = 0;
    let last30dTransactions = 0;

    const recentTransactions = transactions
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12)
      .map((transaction) => ({
        signature: transaction.signature,
        timestamp: transaction.timestamp,
        wallet: extractProgramWallet(transaction),
        usdcAmount: extractUsdcVolume(transaction),
        description: transaction.description ?? "RailFi program interaction",
      }));

    for (const transaction of transactions) {
      const wallet = extractProgramWallet(transaction);
      if (wallet !== "Unknown") {
        uniqueWallets.add(wallet);
      }

      totalVolumeUsdc += extractUsdcVolume(transaction);

      const ageSeconds = now - transaction.timestamp;
      if (ageSeconds <= THIRTY_DAYS_SECONDS) {
        last30dTransactions += 1;
      }
      if (ageSeconds <= SEVEN_DAYS_SECONDS) {
        last7dTransactions += 1;
      }
    }

    return {
      totalVolumeUsdc,
      totalTransactions: transactions.length,
      totalUniqueWallets: uniqueWallets.size,
      last7dTransactions,
      last30dTransactions,
      recentTransactions,
      programId: PROGRAM_ID.toBase58(),
      generatedAt: new Date().toISOString(),
      dataSource: "All metrics read directly from the Solana blockchain via Helius.",
      dataTruncated: fetchedTransactions.dataTruncated,
      dataNote: fetchedTransactions.dataTruncated
        ? `Showing the most recent ${fetchedTransactions.pagesFetched * PAGE_SIZE} transactions. Full history remains available on-chain.`
        : "All historical transactions included.",
      degraded: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analytics unavailable.";
    return {
      totalVolumeUsdc: 0,
      totalTransactions: 0,
      totalUniqueWallets: 0,
      last7dTransactions: 0,
      last30dTransactions: 0,
      recentTransactions: [],
      programId: PROGRAM_ID.toBase58(),
      generatedAt: new Date().toISOString(),
      dataSource: "All metrics read directly from the Solana blockchain via Helius.",
      dataTruncated: false,
      dataNote: "Analytics are temporarily unavailable.",
      degraded: true,
      error: message,
    };
  }
});
